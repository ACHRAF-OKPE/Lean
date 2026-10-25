import { Workbook, type CellValue } from "exceljs";
import { describe, expect, it } from "vitest";
import {
  HEADERS_BY_KIND,
  IMPORT_TEMPLATE_PATHS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  PARTNER_HEADERS,
  resolveTemplateKind,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
} from "./constants";
import { ImportFileError } from "./errors";
import { EMPTY_VALIDATION_CONTEXT, validateImportRows, type ValidationContext } from "./validation";
import { buildTemplate, parseWorkbook } from "./xlsx";

type LoadInput = Parameters<Workbook["xlsx"]["load"]>[0];

async function workbookBytes(workbook: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const written = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(written as ArrayBuffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

async function parseSerialized(workbook: Workbook) {
  return parseWorkbook("partners", await workbookBytes(workbook));
}

function partnerSheet(valuesByRow: Record<number, readonly CellValue[]>): Workbook {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(SHEET_DATA);
  sheet.addRow([...PARTNER_HEADERS]);
  for (const [rowNumber, values] of Object.entries(valuesByRow)) {
    sheet.getRow(Number(rowNumber)).values = [...values];
  }
  return workbook;
}

async function fillTemplate(
  kind: keyof typeof HEADERS_BY_KIND,
  values: Record<string, unknown>,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = await loadWorkbook(await buildTemplate(kind));
  const sheet = workbook.getWorksheet(SHEET_DATA);
  if (!sheet) {
    throw new Error("Feuille Données absente du modèle.");
  }
  HEADERS_BY_KIND[kind].forEach((header, index) => {
    sheet.getRow(2).getCell(index + 1).value = (values[header] ?? null) as CellValue;
  });
  return workbookBytes(workbook);
}

const CONTEXT_WITH_HS: ValidationContext = {
  ...EMPTY_VALIDATION_CONTEXT,
  existingHsCodes: new Map([
    ["0901110000", "Café non torréfié, non décaféiné"],
    ["09011100", "Café non torréfié"],
  ]),
};

describe("ART-005 — modèle XLSX téléchargeable", () => {
  it("produit les trois modèles avec feuilles, en-têtes, formats et référentiel Pays", async () => {
    for (const kind of ["partners", "articles", "hs_codes"] as const) {
      const workbook = await loadWorkbook(await buildTemplate(kind));
      const data = workbook.getWorksheet(SHEET_DATA);

      expect(data).toBeDefined();
      expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
      expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

      const headers = HEADERS_BY_KIND[kind].map(
        (_, index) => data?.getRow(1).getCell(index + 1).value,
      );
      expect(headers).toEqual([...HEADERS_BY_KIND[kind]]);

      const pays = workbook.definedNames.model.find((entry) => entry.name === "Pays");
      expect(pays?.ranges.join(",")).toContain("$D$2:$D$250");

      expect(data?.getColumn(1).numFmt).toBe("@");
    }
  });

  it("fait correspondre chaque chemin public de modèle à son type d'import", () => {
    for (const [kind, path] of Object.entries(IMPORT_TEMPLATE_PATHS)) {
      const slug = path.split("/").pop() ?? "";
      expect(resolveTemplateKind(slug)).toBe(kind);
    }
    expect(resolveTemplateKind("inconnu")).toBeNull();
  });

  it("restreint les colonnes à listes par validation de données", async () => {
    const partners = await loadWorkbook(await buildTemplate("partners"));
    const partnerData = partners.getWorksheet(SHEET_DATA);
    if (!partnerData) {
      throw new Error("Feuille Données absente du modèle tiers.");
    }
    expect(partnerData.getCell("C2").dataValidation).toMatchObject({
      type: "list",
      formulae: ['"Entreprise,Particulier"'],
    });
    expect(partnerData.getCell("J2").dataValidation.formulae).toEqual(["Pays"]);
    expect(partnerData.getCell("M2").dataValidation.formulae).toEqual(['"Oui,Non"']);

    const articles = await loadWorkbook(await buildTemplate("articles"));
    const articleData = articles.getWorksheet(SHEET_DATA);
    if (!articleData) {
      throw new Error("Feuille Données absente du modèle articles.");
    }
    expect(articleData.getColumn(6).numFmt).toBe("@");
    expect(articleData.getColumn(7).numFmt).toBe("#,##0");
    expect(articleData.getCell("E2").dataValidation.type).toBe("list");
  });
});

describe("ART-005 — lecture du vrai XLSX", () => {
  it("relit le modèle tiers rempli et produit une ligne valide", async () => {
    const bytes = await fillTemplate("partners", {
      code: "CLI010",
      nom: "Baobab Négoce",
      type: "Entreprise",
      client: "Oui",
      fournisseur: "Non",
      email: "contact@baobab.example",
      telephone: "+225 27 00 00 00",
      adresse: "Zone 4",
      ville: "Abidjan",
      pays: "CI",
      numero_fiscal: "CI1234567",
      delai_paiement_jours: 45,
      actif: "Oui",
    });

    const parsed = await parseWorkbook("partners", bytes);

    expect(parsed.sheetName).toBe(SHEET_DATA);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rowNumber).toBe(2);
    expect(parsed.rows[0]?.values).toMatchObject({
      code: "CLI010",
      nom: "Baobab Négoce",
      type: "Entreprise",
      client: "Oui",
      fournisseur: "Non",
      pays: "CI",
      delai_paiement_jours: 45,
    });

    const validation = validateImportRows("partners", parsed.rows);
    expect(validation.errorCount).toBe(0);
    expect(validation.warningCount).toBe(0);
  });

  it("relit le modèle articles rempli et conserve les codes SH en texte", async () => {
    const bytes = await fillTemplate("articles", {
      code: "ART010",
      designation: "Café vert",
      type: "Produit",
      unite: "KG",
      code_sh: "0901110000",
      prix_vente_xof: 250000,
      prix_achat_xof: 180000,
      vendable: "Oui",
      achetable: "Oui",
      pays_origine: "CI",
      actif: "Oui",
    });

    const parsed = await parseWorkbook("articles", bytes);

    expect(parsed.rows[0]?.values["code_sh"]).toBe("0901110000");
    expect(parsed.rows[0]?.values["prix_vente_xof"]).toBe(250000);
    const validation = validateImportRows("articles", parsed.rows, CONTEXT_WITH_HS);
    expect(validation.errorCount).toBe(0);
    expect(validation.warningCount).toBe(0);
  });

  it("relit le modèle nomenclature rempli avec un parent", async () => {
    const bytes = await fillTemplate("hs_codes", {
      code: "09011100",
      libelle: "Café non torréfié",
      code_parent: "090111",
      unite_complementaire: "KG",
    });

    const parsed = await parseWorkbook("hs_codes", bytes);
    const validation = validateImportRows("hs_codes", parsed.rows, {
      ...EMPTY_VALIDATION_CONTEXT,
      existingHsCodes: new Map([["090111", "Café non torréfié"]]),
    });

    expect(validation.errorCount).toBe(0);
    expect(parsed.rows[0]?.values["code_parent"]).toBe("090111");
  });

  it("refuse un modèle encore vide", async () => {
    await expect(parseWorkbook("hs_codes", await buildTemplate("hs_codes"))).rejects.toThrow(
      "Aucune ligne de données à analyser sous les en-têtes.",
    );
  });

  it("signale une feuille Données écrite sans accent", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Donnees");
    sheet.addRow([...PARTNER_HEADERS]);
    sheet.getRow(2).values = ["CLI001", "Sahel", "Entreprise", "Oui", "Non"];

    const parsed = await parseSerialized(workbook);

    expect(parsed.notes).toContain(
      "Feuille « Données » introuvable : analyse de la feuille « Donnees ».",
    );
  });

  it("analyse la première feuille si aucune ne porte le nom attendu", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Import 2026");
    sheet.addRow([...PARTNER_HEADERS]);
    sheet.getRow(2).values = ["CLI001", "Sahel", "Entreprise", "Oui", "Non"];

    const parsed = await parseSerialized(workbook);

    expect(parsed.notes).toContain(
      "Feuille « Données » introuvable : analyse de la première feuille « Import 2026 ».",
    );
  });

  it("accepte des en-têtes normalisés et signale la normalisation", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(SHEET_DATA);
    sheet.addRow(PARTNER_HEADERS.map((header, index) => (index === 0 ? "Code" : header)));
    sheet.getRow(2).values = ["CLI001", "Sahel", "Entreprise", "Oui", "Non"];

    const parsed = await parseSerialized(workbook);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.notes).toContain("En-tête A1 : « Code » normalisé en « code ».");
  });

  it("ignore les colonnes supplémentaires en le signalant", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(SHEET_DATA);
    const header: (string | null)[] = [...PARTNER_HEADERS];
    header[13] = "commentaire";
    sheet.addRow(header);
    sheet.getRow(2).values = [
      "CLI001",
      "Sahel",
      "Entreprise",
      "Oui",
      "Non",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "note",
    ];

    const parsed = await parseSerialized(workbook);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.notes).toContain("Colonnes supplémentaires ignorées : N (« commentaire »).");
  });

  it("saute les lignes entièrement vides sans décaler les numéros de ligne", async () => {
    const workbook = partnerSheet({
      2: ["CLI001", "Sahel", "Entreprise", "Oui", "Non"],
      4: ["CLI002", "Baobab", "Entreprise", "Non", "Oui"],
    });

    const parsed = await parseSerialized(workbook);

    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(parsed.rows.map((row) => row.values["code"])).toEqual(["CLI001", "CLI002"]);
  });

  it("conserve une valeur numérique brute pour que la validation la signale", async () => {
    const workbook = partnerSheet({
      2: [12345, "Sahel", "Entreprise", "Oui", "Non"],
    });

    const parsed = await parseSerialized(workbook);
    const validation = validateImportRows("partners", parsed.rows);

    expect(parsed.rows[0]?.values["code"]).toBe(12345);
    expect(validation.rows[0]?.warnings).toContain(
      "Code : valeur lue comme nombre ; formater la colonne en texte.",
    );
  });
});

describe("ART-005 — refus des fichiers non exploitables", () => {
  it("refuse un fichier vide", async () => {
    await expect(parseWorkbook("partners", new Uint8Array())).rejects.toThrow(
      "Le fichier est vide.",
    );
  });

  it("refuse un format qui n'est pas un classeur ZIP", async () => {
    await expect(
      parseWorkbook("partners", new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    ).rejects.toThrow("Format non reconnu");
  });

  it("refuse un fichier au-delà de la limite de taille", async () => {
    const oversized = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    oversized.set([0x50, 0x4b, 0x03, 0x04]);

    await expect(parseWorkbook("partners", oversized)).rejects.toThrow("Fichier trop volumineux");
  });

  it("refuse un classeur illisible malgré la signature ZIP", async () => {
    const corrupt = new Uint8Array(64);
    corrupt.set([0x50, 0x4b, 0x03, 0x04]);

    await expect(parseWorkbook("partners", corrupt)).rejects.toBeInstanceOf(ImportFileError);
  });

  it("refuse des en-têtes non conformes avec la colonne fautive", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(SHEET_DATA);
    sheet.addRow(["reference", "nom", "type", "client", "fournisseur"]);
    sheet.getRow(2).values = ["CLI001", "Sahel", "Entreprise", "Oui", "Non"];

    await expect(parseSerialized(workbook)).rejects.toThrow(
      /A1 : « reference » au lieu de « code »/,
    );
  });

  it("refuse plus de lignes que la limite", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(SHEET_DATA);
    sheet.addRow(["code", "libelle", "code_parent", "unite_complementaire"]);
    for (let index = 0; index <= MAX_IMPORT_ROWS; index += 1) {
      sheet.addRow([String(100000 + index), `Libellé ${index}`, null, null]);
    }

    await expect(parseWorkbook("hs_codes", await workbookBytes(workbook))).rejects.toThrow(
      `Trop de lignes : ${MAX_IMPORT_ROWS} lignes de données maximum par fichier.`,
    );
  });
});
