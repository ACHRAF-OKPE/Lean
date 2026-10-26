import { createHash } from "node:crypto";
import { Workbook, type Cell, type CellValue, type Worksheet } from "exceljs";
import type { ImportKind } from "@/db/schema";
import {
  ARTICLE_HEADERS,
  COUNTRY_CODES,
  HEADERS_BY_KIND,
  HS_HEADERS,
  IMPORT_KIND_LABELS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_MB,
  MAX_IMPORT_ROWS,
  PARTNER_HEADERS,
  PURCHASE_LINE_HEADERS,
  SALES_LINE_HEADERS,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
  UNITS,
} from "./constants";
import type { RawImportRow } from "./validation";
import { ImportFileError } from "./errors";

export interface ParsedWorkbook {
  readonly sheetName: string;
  readonly fileHash: string;
  readonly rows: readonly RawImportRow[];
  readonly notes: readonly string[];
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

const TEMPLATE_FILE_NAMES: Record<ImportKind, string> = {
  partners: "lean-modele-tiers.xlsx",
  articles: "lean-modele-articles.xlsx",
  hs_codes: "lean-modele-nomenclature.xlsx",
  purchase_lines: "lean-modele-commandes.xlsx",
  sales_lines: "lean-modele-ventes.xlsx",
};

export function templateFileName(kind: ImportKind): string {
  return TEMPLATE_FILE_NAMES[kind];
}

function columnLetter(index: number): string {
  let label = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

interface NormalizedCell {
  readonly value: unknown;
  readonly note: string | null;
}

function normalizeCell(value: CellValue): NormalizedCell {
  if (value === null || value === undefined) {
    return { value: null, note: null };
  }
  if (value instanceof Date) {
    return {
      value: value.toISOString().slice(0, 10),
      note: "date lue au format AAAA-MM-JJ",
    };
  }
  if (typeof value !== "object") {
    return { value, note: null };
  }
  if ("richText" in value) {
    return { value: value.richText.map((part) => part.text).join(""), note: null };
  }
  if ("text" in value) {
    return { value: value.text, note: null };
  }
  if ("error" in value) {
    return { value: null, note: `cellule en erreur (${value.error}) ignorée` };
  }

  const formula = "sharedFormula" in value ? (value.formula ?? value.sharedFormula) : value.formula;
  if (formula !== undefined) {
    const result = value.result;
    if (result === undefined || result === null) {
      return { value: null, note: "formule sans résultat mémorisé, lue comme vide" };
    }
    return normalizeCell(result);
  }

  return { value: null, note: null };
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function findDataSheet(workbook: Workbook): { sheet: Worksheet; note: string | null } {
  const exact = workbook.getWorksheet(SHEET_DATA);
  if (exact) {
    return { sheet: exact, note: null };
  }

  const folded = workbook.worksheets.find(
    (worksheet) => normalizeLabel(worksheet.name) === normalizeLabel(SHEET_DATA),
  );
  if (folded) {
    return {
      sheet: folded,
      note: `Feuille « ${SHEET_DATA} » introuvable : analyse de la feuille « ${folded.name} ».`,
    };
  }

  const first = workbook.worksheets.find((worksheet) => worksheet.actualRowCount > 0);
  if (!first) {
    throw new ImportFileError("Le classeur ne contient aucune feuille exploitable.");
  }
  return {
    sheet: first,
    note: `Feuille « ${SHEET_DATA} » introuvable : analyse de la première feuille « ${first.name} ».`,
  };
}

export async function parseWorkbook(kind: ImportKind, data: Uint8Array): Promise<ParsedWorkbook> {
  if (data.length === 0) {
    throw new ImportFileError("Le fichier est vide.");
  }
  if (data.length > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileError(
      `Fichier trop volumineux : ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} Mo maximum.`,
    );
  }
  if (!ZIP_SIGNATURE.every((byte, index) => data[index] === byte)) {
    throw new ImportFileError(
      "Format non reconnu : déposez un classeur Excel au format .xlsx (pas .xls ni .csv).",
    );
  }

  const workbook = new Workbook();
  try {
    type LoadInput = Parameters<Workbook["xlsx"]["load"]>[0];
    await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  } catch {
    throw new ImportFileError(
      "Classeur illisible : vérifiez qu'il s'agit d'un fichier .xlsx non protégé par mot de passe.",
    );
  }

  const { sheet, note } = findDataSheet(workbook);
  const notes: string[] = note ? [note] : [];
  const headers = HEADERS_BY_KIND[kind];

  if (sheet.actualRowCount === 0) {
    throw new ImportFileError(`La feuille « ${sheet.name} » est vide.`);
  }

  const headerRow = sheet.getRow(1);
  const headerProblems: string[] = [];
  for (let index = 0; index < headers.length; index += 1) {
    const expected = headers[index]!;
    const cell = headerRow.getCell(index + 1);
    const raw = cellText(normalizeCell(cell.value).value).trim();

    if (normalizeLabel(raw) !== expected) {
      headerProblems.push(
        `${columnLetter(index + 1)}1 : « ${raw || "(vide)"} » au lieu de « ${expected} »`,
      );
    } else if (raw !== expected) {
      notes.push(`En-tête ${columnLetter(index + 1)}1 : « ${raw} » normalisé en « ${expected} ».`);
    }
  }
  if (headerProblems.length > 0) {
    throw new ImportFileError(
      `En-têtes non conformes (${headerProblems.join(" ; ")}). Téléchargez le modèle pour repartir d'une base exacte.`,
    );
  }

  const knownColumns = headers.length;
  const maxColumn = Math.max(sheet.columnCount, headerRow.cellCount);
  const extraHeaders: string[] = [];
  for (let index = knownColumns + 1; index <= maxColumn; index += 1) {
    const raw = cellText(normalizeCell(headerRow.getCell(index).value).value).trim();
    if (raw) {
      extraHeaders.push(`${columnLetter(index)} (« ${raw} »)`);
    }
  }
  if (extraHeaders.length > 0) {
    notes.push(`Colonnes supplémentaires ignorées : ${extraHeaders.join(", ")}.`);
  }

  const rows: RawImportRow[] = [];
  const rowLimit = sheet.rowCount;
  for (let rowNumber = 2; rowNumber <= rowLimit; rowNumber += 1) {
    const sheetRow = sheet.getRow(rowNumber);
    const values: Record<string, unknown> = {};
    const rowNotes: string[] = [];
    let hasValue = false;

    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index]!;
      const normalized = normalizeCell(sheetRow.getCell(index + 1).value);
      values[header] = normalized.value;
      if (normalized.note) {
        rowNotes.push(`Ligne ${rowNumber}, colonne « ${header} » : ${normalized.note}.`);
      }
      if (!isBlank(normalized.value)) {
        hasValue = true;
      }
    }

    if (!hasValue) {
      continue;
    }
    if (rows.length >= MAX_IMPORT_ROWS) {
      throw new ImportFileError(
        `Trop de lignes : ${MAX_IMPORT_ROWS} lignes de données maximum par fichier.`,
      );
    }
    notes.push(...rowNotes);
    rows.push({ rowNumber, values });
  }

  if (rows.length === 0) {
    throw new ImportFileError("Aucune ligne de données à analyser sous les en-têtes.");
  }

  return {
    sheetName: sheet.name,
    fileHash: createHash("sha256").update(data).digest("hex"),
    rows,
    notes,
  };
}

interface ColumnMeta {
  readonly width: number;
  readonly text?: boolean;
  readonly integer?: boolean;
  readonly list?: string;
  readonly listRange?: string;
  readonly listError?: string;
}

const PARTNER_COLUMN_META: Record<(typeof PARTNER_HEADERS)[number], ColumnMeta> = {
  code: { width: 14, text: true },
  nom: { width: 34 },
  type: { width: 16, list: '"Entreprise,Particulier"' },
  client: { width: 10, list: '"Oui,Non"' },
  fournisseur: { width: 12, list: '"Oui,Non"' },
  email: { width: 30 },
  telephone: { width: 20 },
  adresse: { width: 32 },
  ville: { width: 18 },
  pays: {
    width: 10,
    listRange: "Pays",
    listError: "Choisissez un code pays ISO 3166-1 à deux lettres (ex. SN).",
  },
  numero_fiscal: { width: 22 },
  delai_paiement_jours: { width: 20, integer: true },
  actif: { width: 10, list: '"Oui,Non"' },
};

const ARTICLE_COLUMN_META: Record<(typeof ARTICLE_HEADERS)[number], ColumnMeta> = {
  code: { width: 14, text: true },
  designation: { width: 34 },
  description: { width: 44 },
  type: { width: 14, list: '"Produit,Service"' },
  unite: { width: 10, list: '"PCE,KG,G,T,L,ML,M,M2,M3,H,J,KWH,BX,CT,SAC,PAL,ROL,SET,PAQ,DZ"' },
  code_sh: { width: 16, text: true },
  prix_vente_xof: { width: 18, integer: true },
  prix_achat_xof: { width: 18, integer: true },
  vendable: { width: 12, list: '"Oui,Non"' },
  achetable: { width: 12, list: '"Oui,Non"' },
  pays_origine: {
    width: 14,
    listRange: "Pays",
    listError: "Choisissez un code pays ISO 3166-1 à deux lettres (ex. SN).",
  },
  actif: { width: 10, list: '"Oui,Non"' },
};

const HS_COLUMN_META: Record<(typeof HS_HEADERS)[number], ColumnMeta> = {
  code: { width: 16, text: true },
  libelle: { width: 52 },
  code_parent: { width: 16, text: true },
  unite_complementaire: { width: 24 },
};

const PURCHASE_LINE_COLUMN_META: Record<(typeof PURCHASE_LINE_HEADERS)[number], ColumnMeta> = {
  fournisseur: { width: 16, text: true },
  article: { width: 16, text: true },
  quantite: { width: 14, text: true },
  prix_unitaire_xof: { width: 18, integer: true },
  date_reception_prevue: { width: 20, text: true },
  reference_externe: { width: 24 },
};

const SALES_LINE_COLUMN_META: Record<(typeof SALES_LINE_HEADERS)[number], ColumnMeta> = {
  client: { width: 16, text: true },
  article: { width: 16, text: true },
  quantite: { width: 14, text: true },
  prix_unitaire_xof: { width: 18, integer: true },
  date_livraison_prevue: { width: 20, text: true },
  reference_externe: { width: 24 },
};

const COLUMN_META: Record<ImportKind, Record<string, ColumnMeta>> = {
  partners: PARTNER_COLUMN_META,
  articles: ARTICLE_COLUMN_META,
  hs_codes: HS_COLUMN_META,
  purchase_lines: PURCHASE_LINE_COLUMN_META,
  sales_lines: SALES_LINE_COLUMN_META,
};

const PARTNER_COLUMN_HELP: Record<(typeof PARTNER_HEADERS)[number], string> = {
  code: "Obligatoire. 32 caractères maximum : lettres, chiffres, point, tiret, barre oblique, souligné.",
  nom: "Obligatoire. 120 caractères maximum.",
  type: "Entreprise ou Particulier.",
  client: "Oui ou Non. Un tiers doit être au moins client ou fournisseur.",
  fournisseur: "Oui ou Non. Un tiers doit être au moins client ou fournisseur.",
  email: "Adresse e-mail complète, facultative.",
  telephone: "30 caractères maximum, facultatif.",
  adresse: "200 caractères maximum, facultatif.",
  ville: "80 caractères maximum, facultatif.",
  pays: "Code ISO 3166-1 à deux lettres (ex. SN pour le Sénégal), facultatif.",
  numero_fiscal: "40 caractères maximum, facultatif.",
  delai_paiement_jours: "Entier de 0 à 365, sans décimale. Vide = 0.",
  actif: "Oui ou Non. Vide = Oui.",
};

const ARTICLE_COLUMN_HELP: Record<(typeof ARTICLE_HEADERS)[number], string> = {
  code: "Obligatoire. 32 caractères maximum : lettres, chiffres, point, tiret, barre oblique, souligné.",
  designation: "Obligatoire. 160 caractères maximum.",
  description: "1000 caractères maximum, facultatif.",
  type: "Produit ou Service.",
  unite:
    "Code d'unité de la liste : PCE, KG, G, T, L, ML, M, M2, M3, H, J, KWH, BX, CT, SAC, PAL, ROL, SET, PAQ, DZ.",
  code_sh:
    "6, 8 ou 10 chiffres. Obligatoire pour un produit ; doit exister dans la nomenclature. Vide pour un service.",
  prix_vente_xof: "Montant XOF entier, sans décimale. Vide = 0.",
  prix_achat_xof: "Montant XOF entier, sans décimale. Vide = 0.",
  vendable: "Oui ou Non. Un article doit être au moins vendable ou achetable.",
  achetable: "Oui ou Non. Un article doit être au moins vendable ou achetable.",
  pays_origine: "Code ISO 3166-1 à deux lettres, facultatif.",
  actif: "Oui ou Non. Vide = Oui.",
};

const HS_COLUMN_HELP: Record<(typeof HS_HEADERS)[number], string> = {
  code: "Obligatoire. 6, 8 ou 10 chiffres (ex. 0901110000). Format texte conseillé.",
  libelle: "Obligatoire. 240 caractères maximum.",
  code_parent:
    "Facultatif. Doit être un préfixe strict du code et déjà présent dans la nomenclature ou dans ce fichier.",
  unite_complementaire: "30 caractères maximum, facultatif.",
};

const PURCHASE_LINE_COLUMN_HELP: Record<(typeof PURCHASE_LINE_HEADERS)[number], string> = {
  fournisseur: "Obligatoire. Code d'un tiers existant, actif et portant le rôle fournisseur.",
  article: "Obligatoire. Code d'un article existant, actif et achetable.",
  quantite: "Obligatoire. Nombre positif, 6 décimales maximum (virgule ou point décimal).",
  prix_unitaire_xof: "Obligatoire. Montant XOF entier, sans décimale.",
  date_reception_prevue: "Facultative. Date AAAA-MM-JJ, aujourd'hui ou future.",
  reference_externe: "Facultative. 60 caractères maximum ; elle sépare les groupes de commande.",
};

const SALES_LINE_COLUMN_HELP: Record<(typeof SALES_LINE_HEADERS)[number], string> = {
  client: "Obligatoire. Code d'un tiers existant, actif et portant le rôle client.",
  article: "Obligatoire. Code d'un article existant, actif et vendable.",
  quantite: "Obligatoire. Nombre positif, 6 décimales maximum (virgule ou point décimal).",
  prix_unitaire_xof: "Obligatoire. Montant XOF entier, sans décimale.",
  date_livraison_prevue: "Facultative. Date AAAA-MM-JJ, aujourd'hui ou future.",
  reference_externe: "Facultative. 60 caractères maximum ; elle sépare les groupes de commande.",
};

const COLUMN_HELP: Record<ImportKind, Record<string, string>> = {
  partners: PARTNER_COLUMN_HELP,
  articles: ARTICLE_COLUMN_HELP,
  hs_codes: HS_COLUMN_HELP,
  purchase_lines: PURCHASE_LINE_COLUMN_HELP,
  sales_lines: SALES_LINE_COLUMN_HELP,
};

const EXAMPLES: Record<ImportKind, Record<string, string>> = {
  partners: {
    code: "CLI001",
    nom: "Sahel Distribution SARL",
    type: "Entreprise",
    client: "Oui",
    fournisseur: "Non",
    email: "contact@sahel-distribution.example",
    telephone: "+221 33 000 00 00",
    adresse: "Zone industrielle",
    ville: "Dakar",
    pays: "SN",
    numero_fiscal: "SN123456789",
    delai_paiement_jours: "30",
    actif: "Oui",
  },
  articles: {
    code: "ART001",
    designation: "Café vert en sacs de 60 kg",
    description: "Arabica non torréfié",
    type: "Produit",
    unite: "KG",
    code_sh: "0901110000",
    prix_vente_xof: "250000",
    prix_achat_xof: "180000",
    vendable: "Oui",
    achetable: "Oui",
    pays_origine: "CI",
    actif: "Oui",
  },
  hs_codes: {
    code: "0901110000",
    libelle: "Café non torréfié, non décaféiné",
    code_parent: "",
    unite_complementaire: "KG",
  },
  purchase_lines: {
    fournisseur: "FOUR001",
    article: "ART001",
    quantite: "12,5",
    prix_unitaire_xof: "180000",
    date_reception_prevue: "2026-11-15",
    reference_externe: "PO-SN-2026-014",
  },
  sales_lines: {
    client: "CLI001",
    article: "ART001",
    quantite: "10",
    prix_unitaire_xof: "250000",
    date_livraison_prevue: "2026-11-20",
    reference_externe: "SO-SN-2026-021",
  },
};

const KIND_RULES: Record<ImportKind, readonly string[]> = {
  partners: [
    "Le code est unique dans l'espace de travail : une ligne existante est mise à jour, pas dupliquée.",
    "Au moins un rôle Client ou Fournisseur doit être renseigné.",
    "Le pays, s'il est renseigné, utilise le code ISO à deux lettres.",
    "Le délai de paiement est un entier compris entre 0 et 365 jours.",
  ],
  articles: [
    "Le code est unique dans l'espace de travail : une ligne existante est mise à jour, pas dupliquée.",
    "Un produit exige un code SH à 6, 8 ou 10 chiffres, déjà présent dans la nomenclature douanière.",
    "Un service ne porte jamais de code SH.",
    "L'unité provient de la liste du modèle ; les prix sont des montants XOF entiers.",
    "Un article doit être au moins vendable ou achetable.",
  ],
  hs_codes: [
    "Le code contient 6, 8 ou 10 chiffres ; les codes à 8 et 10 chiffres peuvent avoir un parent.",
    "Le code parent, s'il est renseigné, est un préfixe strict du code.",
    "Importez les parents avant les enfants, ou placez les deux dans le même fichier.",
    "Un code existant est mis à jour, pas dupliqué.",
  ],
  purchase_lines: [
    "Chaque ligne référence un fournisseur existant, actif et fournisseur, et un article existant, actif et achetable.",
    "Les lignes sont groupées par fournisseur, date de réception prévue et référence externe.",
    "Chaque groupe crée une commande en brouillon : aucune commande existante n'est modifiée.",
    "Un même fichier ne peut être appliqué qu'une seule fois.",
    "Une date passée ou un prix différent du prix d'achat de la fiche produit un avertissement.",
  ],
  sales_lines: [
    "Chaque ligne référence un client existant, actif et client, et un article existant, actif et vendable.",
    "Les lignes sont groupées par client, date de livraison prévue et référence externe.",
    "Chaque groupe crée une commande client en brouillon : aucune commande existante n'est modifiée.",
    "Un même fichier ne peut être appliqué qu'une seule fois.",
    "Une date passée ou un prix différent du prix de vente de la fiche produit un avertissement.",
    "L'incoterm n'est pas transporté par l'import : il se renseigne sur la fiche de la commande.",
  ],
};

const HEADER_FILL = "FF1F4D3A";
const HEADER_FONT = "FFFFFFFF";
const HEADER_TEXT = "FF1F4D3A";

function styleHeaderCell(cell: Cell): void {
  cell.font = { bold: true, size: 10, color: { argb: HEADER_FONT } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  cell.alignment = { vertical: "middle", wrapText: false };
}

function buildDataSheet(sheet: Worksheet, kind: ImportKind): void {
  const headers = HEADERS_BY_KIND[kind];
  const meta = COLUMN_META[kind];
  const help = COLUMN_HELP[kind];
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;

  headers.forEach((header, index) => {
    const column = index + 1;
    const cell = headerRow.getCell(column);
    cell.value = header;
    styleHeaderCell(cell);
    cell.note = help[header] ?? "";
    sheet.getColumn(column).width = meta[header]?.width ?? 20;
    if (meta[header]?.text) {
      sheet.getColumn(column).numFmt = "@";
    } else if (meta[header]?.integer) {
      sheet.getColumn(column).numFmt = "#,##0";
    }
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  headers.forEach((header, index) => {
    const columnMeta = meta[header];
    if (!columnMeta?.list && !columnMeta?.listRange) {
      return;
    }
    const validation = {
      type: "list" as const,
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Valeur non autorisée",
      error: columnMeta.listError ?? "Choisissez une valeur dans la liste.",
      formulae: [columnMeta.listRange ?? columnMeta.list ?? ""],
    };
    for (let rowNumber = 2; rowNumber <= MAX_IMPORT_ROWS + 1; rowNumber += 1) {
      sheet.getCell(rowNumber, index + 1).dataValidation = validation;
    }
  });
}

function buildHelpSheet(workbook: Workbook, kind: ImportKind): void {
  const sheet = workbook.addWorksheet(SHEET_HELP);
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 100;
  let cursor = 1;

  const title = sheet.getRow(cursor).getCell(1);
  title.value = `Modèle d'import — ${IMPORT_KIND_LABELS[kind]}`;
  title.font = { bold: true, size: 15, color: { argb: HEADER_TEXT } };
  cursor += 2;

  const intro = sheet.getRow(cursor).getCell(1);
  intro.value =
    "Remplissez la feuille « Données », une ligne par enregistrement, sans modifier les en-têtes. Les listes déroulantes et les notes d'en-tête rappellent les formats attendus.";
  intro.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(cursor, 1, cursor, 2);
  sheet.getRow(cursor).height = 30;
  cursor += 2;

  const sections: { heading: string; lines: readonly string[] }[] = [
    {
      heading: "Déroulé",
      lines: [
        "1. Téléchargez et complétez ce modèle, ou déposez votre propre XLSX avec exactement les mêmes en-têtes.",
        "2. Lean analyse le fichier et affiche un rapport ligne à ligne : aucune donnée n'est écrite à cette étape.",
        "3. Corrigez les lignes en erreur, relancez l'analyse, puis confirmez l'import.",
        "4. Les lignes valides et les lignes avec avertissement sont écrites ; les lignes en erreur sont ignorées.",
      ],
    },
    { heading: "Règles métier", lines: KIND_RULES[kind] },
    {
      heading: "Limites",
      lines: [
        `Classeur .xlsx de ${MAX_IMPORT_FILE_MB} Mo maximum, ${MAX_IMPORT_ROWS.toLocaleString("fr-FR")} lignes de données maximum, feuille « Données ».`,
        "Les lignes entièrement vides sont ignorées ; les colonnes supplémentaires sont ignorées.",
        "Les codes en majuscules et les valeurs sans espaces superflus sont normalisés et signalés en avertissement.",
      ],
    },
  ];

  for (const section of sections) {
    const heading = sheet.getRow(cursor).getCell(1);
    heading.value = section.heading;
    heading.font = { bold: true, size: 11, color: { argb: HEADER_TEXT } };
    cursor += 1;

    for (const line of section.lines) {
      const cell = sheet.getRow(cursor).getCell(1);
      cell.value = line;
      cell.alignment = { wrapText: true, vertical: "top" };
      sheet.mergeCells(cursor, 1, cursor, 2);
      sheet.getRow(cursor).height = 28;
      cursor += 1;
    }
    cursor += 1;
  }

  const formatsHeading = sheet.getRow(cursor).getCell(1);
  formatsHeading.value = "Formats attendus";
  formatsHeading.font = { bold: true, size: 11, color: { argb: HEADER_TEXT } };
  cursor += 1;

  const formatHeader = sheet.getRow(cursor);
  styleHeaderCell(formatHeader.getCell(1));
  formatHeader.getCell(1).value = "Colonne";
  styleHeaderCell(formatHeader.getCell(2));
  formatHeader.getCell(2).value = "Attendu";
  cursor += 1;

  for (const header of HEADERS_BY_KIND[kind]) {
    const row = sheet.getRow(cursor);
    row.getCell(1).value = header;
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).value = COLUMN_HELP[kind][header] ?? "";
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).font = { size: 10 };
    row.height = 28;
    cursor += 1;
  }
  cursor += 1;

  const exampleHeading = sheet.getRow(cursor).getCell(1);
  exampleHeading.value = "Exemple";
  exampleHeading.font = { bold: true, size: 11, color: { argb: HEADER_TEXT } };
  cursor += 1;

  const exampleNote = sheet.getRow(cursor).getCell(1);
  exampleNote.value =
    "Exemple illustratif : adaptez-le à vos données. Un code SH d'article doit exister dans votre nomenclature avant l'import.";
  exampleNote.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(cursor, 1, cursor, 2);
  sheet.getRow(cursor).height = 28;
  cursor += 1;

  const exampleHeader = sheet.getRow(cursor);
  HEADERS_BY_KIND[kind].forEach((header, index) => {
    const cell = exampleHeader.getCell(index + 1);
    cell.value = header;
    styleHeaderCell(cell);
    sheet.getColumn(index + 1).width = Math.max(sheet.getColumn(index + 1).width ?? 12, 14);
  });
  cursor += 1;

  const exampleRow = sheet.getRow(cursor);
  HEADERS_BY_KIND[kind].forEach((header, index) => {
    const cell = exampleRow.getCell(index + 1);
    cell.value = EXAMPLES[kind][header] ?? "";
    cell.numFmt = "@";
    cell.font = { size: 10 };
  });
}

function buildReferencesSheet(workbook: Workbook): void {
  const sheet = workbook.addWorksheet(SHEET_REFERENCES);
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 22;
  sheet.getColumn(3).width = 4;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 4;
  sheet.getColumn(6).width = 18;
  sheet.getColumn(7).width = 18;

  const header = sheet.getRow(1);
  const labels = [
    { column: 1, label: "Unité" },
    { column: 2, label: "Libellé" },
    { column: 4, label: "Pays" },
    { column: 6, label: "Type de tiers" },
    { column: 7, label: "Type d'article" },
  ];
  for (const item of labels) {
    const cell = header.getCell(item.column);
    cell.value = item.label;
    styleHeaderCell(cell);
  }

  UNITS.forEach((unit, index) => {
    sheet.getCell(index + 2, 1).value = unit.code;
    sheet.getCell(index + 2, 2).value = unit.label;
  });
  COUNTRY_CODES.forEach((code, index) => {
    sheet.getCell(index + 2, 4).value = code;
  });
  ["Entreprise", "Particulier"].forEach((value, index) => {
    sheet.getCell(index + 2, 6).value = value;
  });
  ["Produit", "Service"].forEach((value, index) => {
    sheet.getCell(index + 2, 7).value = value;
  });
}

const templateCache = new Map<ImportKind, Uint8Array<ArrayBuffer>>();

export async function buildTemplate(kind: ImportKind): Promise<Uint8Array<ArrayBuffer>> {
  const cached = templateCache.get(kind);
  if (cached) {
    return cached;
  }

  const workbook = new Workbook();
  workbook.creator = "Lean";
  workbook.lastModifiedBy = "Lean";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = `Modèle d'import — ${IMPORT_KIND_LABELS[kind]}`;
  workbook.description =
    "Modèle officiel Lean. Feuille Données à remplir, une ligne par enregistrement.";

  buildDataSheet(workbook.addWorksheet(SHEET_DATA), kind);
  buildHelpSheet(workbook, kind);
  buildReferencesSheet(workbook);
  workbook.definedNames.add(`'${SHEET_REFERENCES}'!$D$2:$D$250`, "Pays");

  const written = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(written as ArrayBuffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  templateCache.set(kind, bytes);
  return bytes;
}
