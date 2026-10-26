import type { ArticleType, ImportKind, ImportRowStatus, PartnerType } from "@/db/schema";
import type { ArticleReference, SupplierReference } from "@/modules/purchases/validation";
import type { CustomerReference, SalesArticleReference } from "@/modules/sales/validation";
import { validatePurchaseLines } from "@/modules/purchases/import-validation";
import { validateSalesLines } from "@/modules/sales/import-validation";
import { isCountryCode, isUnitCode, MAX_PAYMENT_TERM_DAYS, MAX_XOF_AMOUNT } from "./constants";

export interface RawImportRow {
  readonly rowNumber: number;
  readonly values: Record<string, unknown>;
}

export interface ValidationContext {
  readonly existingPartnerCodes: ReadonlySet<string>;
  readonly existingArticleCodes: ReadonlySet<string>;
  readonly existingHsCodes: ReadonlyMap<string, string>;
  readonly suppliersByCode?: ReadonlyMap<string, SupplierReference>;
  readonly customersByCode?: ReadonlyMap<string, CustomerReference>;
  readonly articlesByCode?: ReadonlyMap<string, ArticleReference>;
  readonly salesArticlesByCode?: ReadonlyMap<string, SalesArticleReference>;
}

export interface ValidatedRow {
  rowNumber: number;
  status: ImportRowStatus;
  code: string | null;
  errors: string[];
  warnings: string[];
  data: Record<string, unknown>;
}

export interface ValidationResult {
  readonly rows: readonly ValidatedRow[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly notes?: readonly string[];
}

export interface PartnerImportData {
  code: string;
  name: string;
  type: PartnerType;
  isCustomer: boolean;
  isSupplier: boolean;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  taxNumber: string | null;
  paymentTermDays: number;
  active: boolean;
}

export interface HsImportData {
  code: string;
  wording: string;
  parentCode: string | null;
  supplementaryUnit: string | null;
}

export interface ArticleImportData {
  code: string;
  name: string;
  description: string | null;
  type: ArticleType;
  unitCode: string;
  hsCode: string | null;
  salePriceXof: number;
  purchasePriceXof: number;
  isSellable: boolean;
  isPurchasable: boolean;
  countryOfOrigin: string | null;
  active: boolean;
}

export const EMPTY_VALIDATION_CONTEXT: ValidationContext = {
  existingPartnerCodes: new Set(),
  existingArticleCodes: new Set(),
  existingHsCodes: new Map(),
  suppliersByCode: new Map(),
  customersByCode: new Map(),
  articlesByCode: new Map(),
  salesArticlesByCode: new Map(),
};

interface Parsed<T> {
  readonly value: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function rawToText(raw: unknown): { text: string; numeric: boolean } {
  if (raw === null || raw === undefined) {
    return { text: "", numeric: false };
  }
  if (typeof raw === "number") {
    return { text: String(raw), numeric: true };
  }
  if (typeof raw === "boolean") {
    return { text: raw ? "oui" : "non", numeric: false };
  }
  return { text: String(raw), numeric: false };
}

function textField(
  raw: unknown,
  label: string,
  options: { required?: boolean; maxLength: number },
): Parsed<string | null> {
  const { text, numeric } = rawToText(raw);
  const value = text.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value !== text) {
    warnings.push(`${label} : espaces de début ou de fin retirés.`);
  }
  if (numeric) {
    warnings.push(`${label} : valeur lue comme nombre.`);
  }
  if (!value) {
    if (options.required) {
      errors.push(`${label} : obligatoire.`);
    }
    return { value: null, errors, warnings };
  }
  if (value.length > options.maxLength) {
    errors.push(`${label} : ${options.maxLength} caractères maximum.`);
  }
  return { value, errors, warnings };
}

function codeField(raw: unknown): Parsed<string | null> {
  const { text, numeric } = rawToText(raw);
  const trimmed = text.trim();
  const value = trimmed.toUpperCase();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (trimmed !== text) {
    warnings.push("Code : espaces de début ou de fin retirés.");
  }
  if (value !== trimmed) {
    warnings.push("Code : normalisé en majuscules.");
  }
  if (numeric) {
    warnings.push("Code : valeur lue comme nombre ; formater la colonne en texte.");
  }
  if (!value) {
    errors.push("Code : obligatoire.");
    return { value: null, errors, warnings };
  }
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(value)) {
    errors.push(
      "Code : 32 caractères maximum, lettres, chiffres, point, tiret, barre oblique ou souligné.",
    );
  }
  return { value, errors, warnings };
}

function emailField(raw: unknown): Parsed<string | null> {
  const { text } = rawToText(raw);
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errors: [], warnings: [] };
  }

  const value = trimmed.toLowerCase();
  const warnings: string[] = [];
  if (trimmed !== text) {
    warnings.push("E-mail : espaces de début ou de fin retirés.");
  }
  if (value !== trimmed) {
    warnings.push("E-mail : normalisé en minuscules.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return { value, errors: ["E-mail : adresse invalide."], warnings };
  }
  return { value, errors: [], warnings };
}

function countryField(raw: unknown, label: string): Parsed<string | null> {
  const { text } = rawToText(raw);
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errors: [], warnings: [] };
  }

  const value = trimmed.toUpperCase();
  const warnings: string[] = [];
  if (trimmed !== text) {
    warnings.push(`${label} : espaces de début ou de fin retirés.`);
  }
  if (value !== trimmed) {
    warnings.push(`${label} : normalisé en majuscules.`);
  }
  if (!isCountryCode(value)) {
    return {
      value,
      errors: [`${label} : code ISO 3166-1 à deux lettres attendu (ex. SN).`],
      warnings,
    };
  }
  return { value, errors: [], warnings };
}

function booleanField(raw: unknown, label: string, fallback: boolean): Parsed<boolean> {
  const { text } = rawToText(raw);
  const value = text.trim().toLowerCase();
  if (!value) {
    return { value: fallback, errors: [], warnings: [] };
  }
  if (["oui", "true", "1"].includes(value)) {
    return { value: true, errors: [], warnings: [] };
  }
  if (["non", "false", "0"].includes(value)) {
    return { value: false, errors: [], warnings: [] };
  }
  return {
    value: fallback,
    errors: [`${label} : répondez Oui ou Non.`],
    warnings: [],
  };
}

function integerField(
  raw: unknown,
  label: string,
  options: { min: number; max: number; fallback: number },
): Parsed<number> {
  const { text, numeric } = rawToText(raw);
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: options.fallback, errors: [], warnings: [] };
  }

  const warnings: string[] = [];
  let candidate = trimmed;
  if (!numeric) {
    const compact = candidate.replace(/[\s\u00a0\u202f]/g, "");
    if (compact !== candidate) {
      warnings.push(`${label} : espaces de séparation retirés.`);
      candidate = compact;
    }
  }

  if (!/^[+-]?\d+$/.test(candidate)) {
    return {
      value: options.fallback,
      errors: [`${label} : nombre entier attendu, sans décimale ni séparateur décimal.`],
      warnings,
    };
  }

  const value = Number(candidate);
  if (!Number.isSafeInteger(value)) {
    return {
      value: options.fallback,
      errors: [`${label} : valeur trop grande.`],
      warnings,
    };
  }
  if (value < options.min || value > options.max) {
    return {
      value: options.fallback,
      errors: [`${label} : doit être compris entre ${options.min} et ${options.max}.`],
      warnings,
    };
  }
  return { value, errors: [], warnings };
}

function partnerTypeField(raw: unknown): Parsed<PartnerType> {
  const { text } = rawToText(raw);
  const value = normalizeWord(text);
  if (["entreprise", "societe", "company"].includes(value)) {
    return { value: "company", errors: [], warnings: [] };
  }
  if (["particulier", "individual"].includes(value)) {
    return { value: "individual", errors: [], warnings: [] };
  }
  return {
    value: "company",
    errors: ["Type : valeurs acceptées Entreprise ou Particulier."],
    warnings: [],
  };
}

function articleTypeField(raw: unknown): Parsed<ArticleType> {
  const { text } = rawToText(raw);
  const value = normalizeWord(text);
  if (["produit", "product"].includes(value)) {
    return { value: "product", errors: [], warnings: [] };
  }
  if (value === "service") {
    return { value: "service", errors: [], warnings: [] };
  }
  return {
    value: "product",
    errors: ["Type : valeurs acceptées Produit ou Service."],
    warnings: [],
  };
}

function normalizeWord(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function unitField(raw: unknown): Parsed<string> {
  const { text } = rawToText(raw);
  const trimmed = text.trim();
  const value = trimmed.toUpperCase();
  const warnings: string[] = [];
  if (!value) {
    return { value, errors: ["Unité : obligatoire (voir la liste du modèle)."], warnings };
  }
  if (trimmed !== text) {
    warnings.push("Unité : espaces de début ou de fin retirés.");
  }
  if (value !== trimmed) {
    warnings.push("Unité : normalisée en majuscules.");
  }
  if (!isUnitCode(value)) {
    return {
      value,
      errors: ["Unité : code non autorisé ; utilisez la liste du modèle."],
      warnings,
    };
  }
  return { value, errors: [], warnings };
}

export function hsCodeField(raw: unknown, required: boolean): Parsed<string | null> {
  const { text, numeric } = rawToText(raw);
  const value = text.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value !== text) {
    warnings.push("Code SH : espaces de début ou de fin retirés.");
  }
  if (numeric) {
    warnings.push("Code SH : valeur lue comme nombre ; formater la colonne en texte.");
  }
  if (!value) {
    if (required) {
      errors.push("Code SH : obligatoire pour un produit.");
    }
    return { value: null, errors, warnings };
  }
  if (!/^\d{6}(\d{2}(\d{2})?)?$/.test(value)) {
    errors.push("Code SH : 6, 8 ou 10 chiffres attendus (ex. 0901110000).");
    return { value, errors, warnings };
  }
  return { value, errors, warnings };
}

function validatePartnerRow(row: RawImportRow, context: ValidationContext): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const code = codeField(row.values["code"]);
  const name = textField(row.values["nom"], "Nom", { required: true, maxLength: 120 });
  const type = partnerTypeField(row.values["type"]);
  const customer = booleanField(row.values["client"], "Client", false);
  const supplier = booleanField(row.values["fournisseur"], "Fournisseur", false);
  const email = emailField(row.values["email"]);
  const phone = textField(row.values["telephone"], "Téléphone", { maxLength: 30 });
  const addressLine = textField(row.values["adresse"], "Adresse", { maxLength: 200 });
  const city = textField(row.values["ville"], "Ville", { maxLength: 80 });
  const country = countryField(row.values["pays"], "Pays");
  const taxNumber = textField(row.values["numero_fiscal"], "Numéro fiscal", {
    maxLength: 40,
  });
  const paymentTermDays = integerField(row.values["delai_paiement_jours"], "Délai de paiement", {
    min: 0,
    max: MAX_PAYMENT_TERM_DAYS,
    fallback: 0,
  });
  const active = booleanField(row.values["actif"], "Actif", true);

  for (const field of [
    code,
    name,
    type,
    customer,
    supplier,
    email,
    phone,
    addressLine,
    city,
    country,
    taxNumber,
    paymentTermDays,
    active,
  ]) {
    errors.push(...field.errors);
    warnings.push(...field.warnings);
  }

  if (!customer.value && !supplier.value) {
    errors.push("Rôles : le tiers doit être au moins client ou fournisseur.");
  }
  if (code.value && context.existingPartnerCodes.has(code.value)) {
    warnings.push("Code déjà présent : la ligne mettra à jour le tiers existant.");
  }

  return {
    rowNumber: row.rowNumber,
    status: "valid",
    code: code.value,
    errors,
    warnings,
    data: {
      code: code.value ?? "",
      name: name.value ?? "",
      type: type.value,
      isCustomer: customer.value,
      isSupplier: supplier.value,
      email: email.value,
      phone: phone.value,
      addressLine: addressLine.value,
      city: city.value,
      countryCode: country.value,
      taxNumber: taxNumber.value,
      paymentTermDays: paymentTermDays.value,
      active: active.value,
    } satisfies PartnerImportData,
  };
}

function validateHsCodeRow(row: RawImportRow, context: ValidationContext): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const code = hsCodeField(row.values["code"], true);
  const wording = textField(row.values["libelle"], "Libellé", {
    required: true,
    maxLength: 240,
  });
  const parentCode = hsCodeField(row.values["code_parent"], false);
  const supplementaryUnit = textField(row.values["unite_complementaire"], "Unité complémentaire", {
    maxLength: 30,
  });

  for (const field of [code, wording, parentCode, supplementaryUnit]) {
    errors.push(...field.errors);
    warnings.push(...field.warnings);
  }

  if (code.value && parentCode.value) {
    if (parentCode.value.length >= code.value.length || !code.value.startsWith(parentCode.value)) {
      errors.push("Code parent : doit être un préfixe strict du code SH.");
    }
  }
  if (code.value && context.existingHsCodes.has(code.value)) {
    warnings.push("Code déjà présent : libellé et parent seront mis à jour.");
  }

  return {
    rowNumber: row.rowNumber,
    status: "valid",
    code: code.value,
    errors,
    warnings,
    data: {
      code: code.value ?? "",
      wording: wording.value ?? "",
      parentCode: parentCode.value,
      supplementaryUnit: supplementaryUnit.value,
    } satisfies HsImportData,
  };
}

function validateArticleRow(row: RawImportRow, context: ValidationContext): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const code = codeField(row.values["code"]);
  const name = textField(row.values["designation"], "Désignation", {
    required: true,
    maxLength: 160,
  });
  const description = textField(row.values["description"], "Description", {
    maxLength: 1000,
  });
  const type = articleTypeField(row.values["type"]);
  const unit = unitField(row.values["unite"]);
  const hsCode = hsCodeField(row.values["code_sh"], type.value === "product");
  const salePrice = integerField(row.values["prix_vente_xof"], "Prix de vente XOF", {
    min: 0,
    max: MAX_XOF_AMOUNT,
    fallback: 0,
  });
  const purchasePrice = integerField(row.values["prix_achat_xof"], "Prix d'achat XOF", {
    min: 0,
    max: MAX_XOF_AMOUNT,
    fallback: 0,
  });
  const sellable = booleanField(row.values["vendable"], "Vendable", true);
  const purchasable = booleanField(row.values["achetable"], "Achetable", true);
  const origin = countryField(row.values["pays_origine"], "Pays d'origine");
  const active = booleanField(row.values["actif"], "Actif", true);

  for (const field of [
    code,
    name,
    description,
    type,
    unit,
    hsCode,
    salePrice,
    purchasePrice,
    sellable,
    purchasable,
    origin,
    active,
  ]) {
    errors.push(...field.errors);
    warnings.push(...field.warnings);
  }

  if (type.value === "service" && hsCode.value) {
    errors.push("Type service : le code SH doit rester vide.");
  }
  if (
    type.value === "product" &&
    hsCode.value &&
    !errors.some((message) => message.startsWith("Code SH :")) &&
    !context.existingHsCodes.has(hsCode.value)
  ) {
    errors.push(`Code SH ${hsCode.value} inconnu : importez d'abord la nomenclature douanière.`);
  }
  if (!sellable.value && !purchasable.value) {
    errors.push("Usages : l'article doit être au moins vendable ou achetable.");
  }
  if (code.value && context.existingArticleCodes.has(code.value)) {
    warnings.push("Code déjà présent : la ligne mettra à jour l'article existant.");
  }

  return {
    rowNumber: row.rowNumber,
    status: "valid",
    code: code.value,
    errors,
    warnings,
    data: {
      code: code.value ?? "",
      name: name.value ?? "",
      description: description.value,
      type: type.value,
      unitCode: unit.value,
      hsCode: hsCode.value,
      salePriceXof: salePrice.value,
      purchasePriceXof: purchasePrice.value,
      isSellable: sellable.value,
      isPurchasable: purchasable.value,
      countryOfOrigin: origin.value,
      active: active.value,
    } satisfies ArticleImportData,
  };
}

function recomputeStatus(row: ValidatedRow): void {
  row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
}

function markDuplicateCodes(rows: readonly ValidatedRow[]): void {
  const groups = new Map<string, ValidatedRow[]>();
  for (const row of rows) {
    if (!row.code) {
      continue;
    }
    const group = groups.get(row.code);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.code, [row]);
    }
  }

  for (const [code, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const lines = group.map((row) => row.rowNumber).join(", ");
    for (const row of group) {
      row.errors.push(`Code ${code} : présent plusieurs fois dans le fichier (lignes ${lines}).`);
    }
  }
}

export function validateImportRows(
  kind: ImportKind,
  rows: readonly RawImportRow[],
  context: ValidationContext = EMPTY_VALIDATION_CONTEXT,
): ValidationResult {
  if (kind === "purchase_lines") {
    return validatePurchaseLines(rows, context);
  }
  if (kind === "sales_lines") {
    return validateSalesLines(rows, context);
  }

  const validated = rows.map((row) => {
    if (kind === "partners") {
      return validatePartnerRow(row, context);
    }
    if (kind === "articles") {
      return validateArticleRow(row, context);
    }
    return validateHsCodeRow(row, context);
  });

  if (kind === "hs_codes") {
    const fileCodes = new Set(
      validated
        .map((row) => row.data.code)
        .filter((code): code is string => typeof code === "string" && code.length > 0),
    );
    for (const row of validated) {
      const parentCode = row.data.parentCode;
      if (
        typeof parentCode === "string" &&
        parentCode.length > 0 &&
        !fileCodes.has(parentCode) &&
        !context.existingHsCodes.has(parentCode)
      ) {
        row.errors.push(
          `Code parent ${parentCode} introuvable dans la nomenclature ni dans ce fichier.`,
        );
      }
    }
  }

  markDuplicateCodes(validated);
  for (const row of validated) {
    recomputeStatus(row);
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
  };
}
