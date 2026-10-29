import type { ArticleType, ImportKind, PartnerType } from "@/db/schema";

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  company: "Entreprise",
  individual: "Particulier",
};

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  product: "Produit",
  service: "Service",
};

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  partners: "Tiers",
  articles: "Articles",
  hs_codes: "Nomenclature douanière",
  purchase_lines: "Lignes de commande",
  sales_lines: "Lignes de vente",
  tasks: "Tâches",
  customs_lines: "Lignes de déclaration",
  customs_apurements: "Apurements progressifs",
  accounts: "Plan comptable",
  journal_entries: "Écritures comptables",
};

const IMPORT_KINDS = [
  "partners",
  "articles",
  "hs_codes",
  "purchase_lines",
  "sales_lines",
  "tasks",
  "customs_lines",
  "customs_apurements",
  "accounts",
  "journal_entries",
] as const;

export function isImportKind(value: string): value is ImportKind {
  return (IMPORT_KINDS as readonly string[]).includes(value);
}

export const IMPORT_KIND_PATHS: Record<ImportKind, string> = {
  partners: "/tiers",
  articles: "/articles",
  hs_codes: "/nomenclature",
  purchase_lines: "/achats",
  sales_lines: "/ventes",
  tasks: "/taches",
  customs_lines: "/douane",
  customs_apurements: "/douane/apurement",
  accounts: "/comptabilite/comptes",
  journal_entries: "/comptabilite/ecritures",
};

export const IMPORT_TEMPLATE_PATHS: Record<ImportKind, string> = {
  partners: "/api/modeles/tiers",
  articles: "/api/modeles/articles",
  hs_codes: "/api/modeles/nomenclature",
  purchase_lines: "/api/modeles/commandes",
  sales_lines: "/api/modeles/ventes",
  tasks: "/api/modeles/taches",
  customs_lines: "/api/modeles/declarations",
  customs_apurements: "/api/modeles/apurements",
  accounts: "/api/modeles/comptes",
  journal_entries: "/api/modeles/ecritures",
};

const TEMPLATE_KIND_BY_SLUG: Record<string, ImportKind> = {
  tiers: "partners",
  articles: "articles",
  nomenclature: "hs_codes",
  commandes: "purchase_lines",
  ventes: "sales_lines",
  taches: "tasks",
  declarations: "customs_lines",
  apurements: "customs_apurements",
  comptes: "accounts",
  ecritures: "journal_entries",
};

export function resolveTemplateKind(slug: string): ImportKind | null {
  return TEMPLATE_KIND_BY_SLUG[slug] ?? null;
}

export const UNITS = [
  { code: "PCE", label: "Pièce" },
  { code: "KG", label: "Kilogramme" },
  { code: "G", label: "Gramme" },
  { code: "T", label: "Tonne" },
  { code: "L", label: "Litre" },
  { code: "ML", label: "Millilitre" },
  { code: "M", label: "Mètre" },
  { code: "M2", label: "Mètre carré" },
  { code: "M3", label: "Mètre cube" },
  { code: "H", label: "Heure" },
  { code: "J", label: "Jour" },
  { code: "KWH", label: "Kilowattheure" },
  { code: "BX", label: "Boîte" },
  { code: "CT", label: "Carton" },
  { code: "SAC", label: "Sac" },
  { code: "PAL", label: "Palette" },
  { code: "ROL", label: "Rouleau" },
  { code: "SET", label: "Lot" },
  { code: "PAQ", label: "Paquet" },
  { code: "DZ", label: "Douzaine" },
] as const;

export type UnitCode = (typeof UNITS)[number]["code"];

export const UNIT_CODES = UNITS.map((unit) => unit.code);

export function isUnitCode(value: string): value is UnitCode {
  return UNITS.some((unit) => unit.code === value);
}

export function unitLabel(code: string): string {
  return UNITS.find((unit) => unit.code === code)?.label ?? code;
}

const COUNTRY_CODES_RAW =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU " +
  "MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB " +
  "SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY " +
  "UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

export const COUNTRY_CODES: readonly string[] = COUNTRY_CODES_RAW.split(" ");

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.includes(value);
}

export const MAX_IMPORT_FILE_MB = 4;
export const MAX_IMPORT_FILE_BYTES = MAX_IMPORT_FILE_MB * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_XOF_AMOUNT = 2_000_000_000;
export const MAX_PAYMENT_TERM_DAYS = 365;

export const PARTNER_HEADERS = [
  "code",
  "nom",
  "type",
  "client",
  "fournisseur",
  "email",
  "telephone",
  "adresse",
  "ville",
  "pays",
  "numero_fiscal",
  "delai_paiement_jours",
  "actif",
] as const;

export const HS_HEADERS = [
  "code",
  "libelle",
  "code_parent",
  "unite_complementaire",
  "taux_tec",
] as const;

export const ARTICLE_HEADERS = [
  "code",
  "designation",
  "description",
  "type",
  "unite",
  "code_sh",
  "prix_vente_xof",
  "prix_achat_xof",
  "vendable",
  "achetable",
  "pays_origine",
  "actif",
] as const;

export const PURCHASE_LINE_HEADERS = [
  "fournisseur",
  "article",
  "quantite",
  "prix_unitaire_xof",
  "date_reception_prevue",
  "reference_externe",
] as const;

export const SALES_LINE_HEADERS = [
  "client",
  "article",
  "quantite",
  "prix_unitaire_xof",
  "date_livraison_prevue",
  "reference_externe",
] as const;

export const TASK_HEADERS = [
  "titre",
  "description",
  "priorite",
  "echeance",
  "assigne_email",
  "document_type",
  "document_reference",
] as const;

export const CUSTOMS_LINE_HEADERS = [
  "numero_declaration",
  "code_sh",
  "designation",
  "quantite",
  "unite",
  "valeur_xof",
  "poids_kg",
  "pays_origine",
] as const;

export const CUSTOMS_APUREMENT_HEADERS = [
  "numero_declaration",
  "ligne",
  "quantite",
  "date_apurement",
  "mode",
  "reference",
] as const;

export const ACCOUNT_HEADERS = ["code", "libelle", "actif"] as const;

export const JOURNAL_ENTRY_HEADERS = [
  "journal",
  "date",
  "piece",
  "libelle",
  "libelle_ligne",
  "compte",
  "tiers",
  "debit",
  "credit",
] as const;

export const HEADERS_BY_KIND = {
  partners: PARTNER_HEADERS,
  articles: ARTICLE_HEADERS,
  hs_codes: HS_HEADERS,
  purchase_lines: PURCHASE_LINE_HEADERS,
  sales_lines: SALES_LINE_HEADERS,
  tasks: TASK_HEADERS,
  customs_lines: CUSTOMS_LINE_HEADERS,
  customs_apurements: CUSTOMS_APUREMENT_HEADERS,
  accounts: ACCOUNT_HEADERS,
  journal_entries: JOURNAL_ENTRY_HEADERS,
} as const;

export const SHEET_DATA = "Données";
export const SHEET_HELP = "Mode d'emploi";
export const SHEET_REFERENCES = "Référentiels";
