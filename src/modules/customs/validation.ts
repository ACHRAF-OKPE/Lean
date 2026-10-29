import type { CustomsApurementMode, PaymentMethod } from "@/db/schema";
import { isCountryCode, isUnitCode } from "@/modules/catalog/constants";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import { parseQuantity } from "@/modules/stock/quantities";
import { isPaymentMethod } from "@/modules/sales/payment-methods";
import { todayIsoDate } from "@/lib/dates";
import {
  CUSTOMS_MAX_APUREMENT_ENTRY_REFERENCE,
  CUSTOMS_MAX_APUREMENT_REFERENCE,
  CUSTOMS_MAX_DESIGNATION,
  CUSTOMS_MAX_GUARANTEE_REFERENCE,
  CUSTOMS_MAX_PAYMENT_REFERENCE,
  CUSTOMS_MAX_REFERENCE,
} from "./constants";
import { normalizeApurementMode } from "./apurement";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HS_CODE_PATTERN = /^[0-9]{6}([0-9]{2}([0-9]{2})?)?$/;
const MAX_WEIGHT_KG = 1_000_000_000;

interface Field<T> {
  readonly value: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function uuidField(raw: unknown, label: string): Field<string | null> {
  const value = textOf(raw);
  if (!value) {
    return { value: null, errors: [`${label} : obligatoire.`], warnings: [] };
  }
  if (!UUID_PATTERN.test(value)) {
    return { value: null, errors: [`${label} : référence invalide.`], warnings: [] };
  }
  return { value, errors: [], warnings: [] };
}

function textField(
  raw: unknown,
  label: string,
  options: { required?: boolean; maxLength: number },
): Field<string | null> {
  const value = textOf(raw);
  if (!value) {
    return {
      value: null,
      errors: options.required ? [`${label} : obligatoire.`] : [],
      warnings: [],
    };
  }
  if (value.length > options.maxLength) {
    return {
      value: null,
      errors: [`${label} : ${options.maxLength} caractères maximum.`],
      warnings: [],
    };
  }
  return { value, errors: [], warnings: [] };
}

function xofField(
  raw: unknown,
  label: string,
  options: { required?: boolean; positive?: boolean },
): Field<number> {
  const text = textOf(raw);
  if (!text) {
    if (options.required) {
      return { value: 0, errors: [`${label} : obligatoire.`], warnings: [] };
    }
    return { value: 0, errors: [], warnings: [] };
  }
  const parsed = parseXofPrice(text, label);
  if (parsed.errors.length === 0 && options.positive && parsed.value <= 0) {
    return {
      value: 0,
      errors: [`${label} : montant strictement positif attendu.`],
      warnings: parsed.warnings,
    };
  }
  return parsed;
}

function dateField(raw: unknown, label: string, required: boolean): Field<string | null> {
  return parseIsoDate(raw, label, required);
}

export function isPaymentDateAllowed(paidDate: string, today: string = todayIsoDate()): boolean {
  return paidDate <= today;
}

export interface DeclarationHeaderInput {
  regimeId: string;
  officeId: string;
  partnerId: string;
  declarationDate: string;
  externalReference: string | null;
  freightAmountXof: number;
  insuranceAmountXof: number;
}

export type DeclarationHeaderFieldsInput = Omit<DeclarationHeaderInput, "regimeId">;

interface DeclarationHeaderRawFields {
  readonly officeId: unknown;
  readonly partnerId: unknown;
  readonly declarationDate: unknown;
  readonly externalReference: unknown;
  readonly freightAmountXof: unknown;
  readonly insuranceAmountXof: unknown;
}

function declarationHeaderFields(raw: DeclarationHeaderRawFields) {
  return {
    office: uuidField(raw.officeId, "Bureau"),
    partner: uuidField(raw.partnerId, "Tiers déclaré"),
    date: dateField(raw.declarationDate, "Date de déclaration", true),
    reference: textField(raw.externalReference, "Référence externe", {
      maxLength: CUSTOMS_MAX_REFERENCE,
    }),
    freight: xofField(raw.freightAmountXof, "Frais de transport", {}),
    insurance: xofField(raw.insuranceAmountXof, "Frais d'assurance", {}),
  };
}

function headerFieldsResult(fields: ReturnType<typeof declarationHeaderFields>): {
  data: DeclarationHeaderFieldsInput | null;
  errors: string[];
  warnings: string[];
} {
  const list: Field<unknown>[] = [
    fields.office,
    fields.partner,
    fields.date,
    fields.reference,
    fields.freight,
    fields.insurance,
  ];
  const errors = list.flatMap((field) => [...field.errors]);
  const warnings = list.flatMap((field) => [...field.warnings]);

  if (errors.length > 0 || !fields.office.value || !fields.partner.value || !fields.date.value) {
    return { data: null, errors, warnings };
  }

  return {
    data: {
      officeId: fields.office.value,
      partnerId: fields.partner.value,
      declarationDate: fields.date.value,
      externalReference: fields.reference.value,
      freightAmountXof: fields.freight.value,
      insuranceAmountXof: fields.insurance.value,
    },
    errors,
    warnings,
  };
}

export function validateDeclarationHeader(
  raw: DeclarationHeaderRawFields & { readonly regimeId: unknown },
): { data: DeclarationHeaderInput | null; errors: string[]; warnings: string[] } {
  const regime = uuidField(raw.regimeId, "Régime");
  const result = headerFieldsResult(declarationHeaderFields(raw));
  const errors = [...regime.errors, ...result.errors];
  const warnings = [...regime.warnings, ...result.warnings];

  if (!result.data || !regime.value || errors.length > 0) {
    return { data: null, errors, warnings };
  }

  return { data: { regimeId: regime.value, ...result.data }, errors, warnings };
}

export function validateDeclarationHeaderFields(raw: DeclarationHeaderRawFields): {
  data: DeclarationHeaderFieldsInput | null;
  errors: string[];
  warnings: string[];
} {
  return headerFieldsResult(declarationHeaderFields(raw));
}

export interface DeclarationLineInput {
  hsCode: string;
  designation: string;
  quantity: string;
  unitCode: string;
  valueXof: number;
  weightKg: string | null;
  originCountry: string;
}

function hsCodeField(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const value = text.replace(/\s/g, "");
  const warnings: string[] = [];
  if (!value) {
    return { value: null, errors: ["Code SH : obligatoire."], warnings };
  }
  if (typeof raw === "number") {
    warnings.push("Code SH lu comme un nombre : vérifiez les zéros de tête.");
  }
  if (!HS_CODE_PATTERN.test(value)) {
    return {
      value: null,
      errors: ["Code SH : 6, 8 ou 10 chiffres attendus."],
      warnings,
    };
  }
  return { value, errors: [], warnings };
}

function unitField(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const value = text.toUpperCase();
  const warnings: string[] = [];
  if (!value) {
    return { value: null, errors: ["Unité : obligatoire."], warnings };
  }
  if (value !== text) {
    warnings.push("Unité : normalisée en majuscules.");
  }
  if (!isUnitCode(value)) {
    return { value: null, errors: ["Unité : code absent de la liste autorisée."], warnings };
  }
  return { value, errors: [], warnings };
}

function originField(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const value = text.toUpperCase();
  const warnings: string[] = [];
  if (!value) {
    return { value: null, errors: ["Pays d'origine : obligatoire."], warnings };
  }
  if (value !== text) {
    warnings.push("Pays d'origine : normalisé en majuscules.");
  }
  if (!isCountryCode(value)) {
    return {
      value: null,
      errors: ["Pays d'origine : code ISO 3166-1 à deux lettres attendu."],
      warnings,
    };
  }
  return { value, errors: [], warnings };
}

function weightField(raw: unknown): Field<string | null> {
  let text = textOf(raw);
  const warnings: string[] = [];
  if (!text) {
    return { value: null, errors: [], warnings };
  }
  if (text.includes(",") && !text.includes(".")) {
    warnings.push("Poids : virgule décimale convertie en point.");
    text = text.replace(",", ".");
  }
  if (!/^\d+(\.\d{1,3})?$/.test(text)) {
    return {
      value: null,
      errors: ["Poids : nombre positif avec trois décimales maximum attendu."],
      warnings,
    };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > MAX_WEIGHT_KG) {
    return { value: null, errors: ["Poids : valeur hors limite."], warnings };
  }
  const [whole = "0", fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return {
    value: `${whole.replace(/^0+(?=\d)/, "")}${trimmed ? `.${trimmed}` : ""}`,
    errors: [],
    warnings,
  };
}

export function validateDeclarationLine(raw: {
  readonly hsCode: unknown;
  readonly designation: unknown;
  readonly quantity: unknown;
  readonly unitCode: unknown;
  readonly valueXof: unknown;
  readonly weightKg: unknown;
  readonly originCountry: unknown;
}): { data: DeclarationLineInput | null; errors: string[]; warnings: string[] } {
  const hsCode = hsCodeField(raw.hsCode);
  const designation = textField(raw.designation, "Désignation", {
    required: true,
    maxLength: CUSTOMS_MAX_DESIGNATION,
  });
  const quantity = parseQuantity(raw.quantity, "Quantité");
  const unit = unitField(raw.unitCode);
  const value = xofField(raw.valueXof, "Valeur en douane", { required: true });
  const weight = weightField(raw.weightKg);
  const origin = originField(raw.originCountry);

  const fields: Field<unknown>[] = [hsCode, designation, quantity, unit, value, weight, origin];
  const errors = fields.flatMap((field) => [...field.errors]);
  const warnings = fields.flatMap((field) => [...field.warnings]);

  if (errors.length > 0 || !hsCode.value || !designation.value || !quantity.value) {
    return { data: null, errors, warnings };
  }
  if (!unit.value || !origin.value) {
    return { data: null, errors, warnings };
  }

  return {
    data: {
      hsCode: hsCode.value,
      designation: designation.value,
      quantity: quantity.value,
      unitCode: unit.value,
      valueXof: value.value,
      weightKg: weight.value,
      originCountry: origin.value,
    },
    errors,
    warnings,
  };
}

export interface BondInput {
  guaranteeAmountXof: number;
  guaranteeReference: string;
}

export function validateBondInput(raw: {
  readonly guaranteeAmountXof: unknown;
  readonly guaranteeReference: unknown;
}): { data: BondInput | null; errors: string[] } {
  const amount = xofField(raw.guaranteeAmountXof, "Montant de garantie", {
    required: true,
    positive: true,
  });
  const reference = textField(raw.guaranteeReference, "Référence de garantie", {
    required: true,
    maxLength: CUSTOMS_MAX_GUARANTEE_REFERENCE,
  });
  const errors = [...amount.errors, ...reference.errors];
  if (errors.length > 0 || !reference.value) {
    return { data: null, errors };
  }
  return {
    data: { guaranteeAmountXof: amount.value, guaranteeReference: reference.value },
    errors,
  };
}

export interface PaymentInput {
  amountXof: number;
  method: PaymentMethod;
  paidDate: string;
  reference: string | null;
}

export function validatePaymentInput(
  raw: {
    readonly amountXof: unknown;
    readonly method: unknown;
    readonly paidDate: unknown;
    readonly reference: unknown;
  },
  today: string = todayIsoDate(),
): { data: PaymentInput | null; errors: string[] } {
  const amount = xofField(raw.amountXof, "Montant du paiement", {
    required: true,
    positive: true,
  });
  const methodText = textOf(raw.method);
  const paidDate = dateField(raw.paidDate, "Date de paiement", true);
  const reference = textField(raw.reference, "Référence", {
    maxLength: CUSTOMS_MAX_PAYMENT_REFERENCE,
  });

  const errors = [...amount.errors, ...reference.errors];
  if (!isPaymentMethod(methodText)) {
    errors.push("Mode de paiement : valeur inconnue.");
  }
  errors.push(...paidDate.errors);
  if (paidDate.value && !isPaymentDateAllowed(paidDate.value, today)) {
    errors.push("Date de paiement : aujourd'hui au plus tard.");
  }
  if (errors.length > 0 || !paidDate.value || !isPaymentMethod(methodText)) {
    return { data: null, errors };
  }
  return {
    data: {
      amountXof: amount.value,
      method: methodText,
      paidDate: paidDate.value,
      reference: reference.value,
    },
    errors,
  };
}

export interface OfficeInput {
  code: string;
  name: string;
}

export function validateOfficeInput(raw: { readonly code: unknown; readonly name: unknown }): {
  data: OfficeInput | null;
  errors: string[];
  warnings: string[];
} {
  const text = textOf(raw.code);
  const code = text.toUpperCase();
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!code) {
    errors.push("Code du bureau : obligatoire.");
  } else {
    if (code !== text) {
      warnings.push("Code du bureau : normalisé en majuscules.");
    }
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)) {
      errors.push("Code du bureau : code UN/LOCODE de cinq caractères attendu (ex. CIABJ).");
    }
  }
  const name = textField(raw.name, "Nom du bureau", { required: true, maxLength: 120 });
  errors.push(...name.errors);
  if (errors.length > 0 || !name.value) {
    return { data: null, errors, warnings };
  }
  return { data: { code, name: name.value }, errors, warnings };
}

export interface RegimeInput {
  code: string;
  label: string;
  kind: "import" | "export" | "suspensive" | "transit";
  requiresBond: boolean;
  requiresApurement: boolean;
}

export function validateRegimeInput(raw: {
  readonly code: unknown;
  readonly label: unknown;
  readonly kind: unknown;
  readonly requiresBond: unknown;
  readonly requiresApurement?: unknown;
}): { data: RegimeInput | null; errors: string[]; warnings: string[] } {
  const text = textOf(raw.code);
  const code = text.toUpperCase();
  const kind = textOf(raw.kind);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!code) {
    errors.push("Code du régime : obligatoire.");
  } else {
    if (code !== text) {
      warnings.push("Code du régime : normalisé en majuscules.");
    }
    if (!/^[A-Z0-9]{2,6}$/.test(code)) {
      errors.push("Code du régime : 2 à 6 caractères alphanumériques attendus.");
    }
  }
  const label = textField(raw.label, "Libellé du régime", { required: true, maxLength: 120 });
  errors.push(...label.errors);
  if (!["import", "export", "suspensive", "transit"].includes(kind)) {
    errors.push("Nature du régime : valeur inconnue.");
  }
  if (errors.length > 0 || !label.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      code,
      label: label.value,
      kind: kind as RegimeInput["kind"],
      requiresBond: raw.requiresBond === true || raw.requiresBond === "on",
      requiresApurement: raw.requiresApurement === true || raw.requiresApurement === "on",
    },
    errors,
    warnings,
  };
}

export interface TaxInput {
  code: string;
  label: string;
  base: "cif" | "cif_plus_duty";
  rateBp: number;
  position: number;
}

export function parseRateBp(raw: unknown): {
  value: number | null;
  errors: string[];
  warnings: string[];
} {
  let text = textOf(raw);
  const warnings: string[] = [];
  if (!text) {
    return { value: null, errors: ["Taux : obligatoire."], warnings };
  }
  if (text.includes(",") && !text.includes(".")) {
    warnings.push("Taux : virgule décimale convertie en point.");
    text = text.replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return {
      value: null,
      errors: ["Taux : pourcentage à deux décimales maximum attendu."],
      warnings,
    };
  }
  const [whole = "0", fraction = ""] = text.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    return { value: null, errors: ["Taux : compris entre 0 et 100 % attendu."], warnings };
  }
  return { value, errors: [], warnings };
}

export function validateTaxInput(raw: {
  readonly code: unknown;
  readonly label: unknown;
  readonly base: unknown;
  readonly rateBp: unknown;
  readonly position: unknown;
}): { data: TaxInput | null; errors: string[]; warnings: string[] } {
  const text = textOf(raw.code);
  const code = text.toUpperCase();
  const base = textOf(raw.base);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!code) {
    errors.push("Code de la taxe : obligatoire.");
  } else {
    if (code !== text) {
      warnings.push("Code de la taxe : normalisé en majuscules.");
    }
    if (!/^[A-Z0-9]{2,6}$/.test(code)) {
      errors.push("Code de la taxe : 2 à 6 caractères alphanumériques attendus.");
    }
  }
  const label = textField(raw.label, "Libellé de la taxe", { required: true, maxLength: 120 });
  errors.push(...label.errors);
  if (!["cif", "cif_plus_duty"].includes(base)) {
    errors.push("Assiette de la taxe : valeur inconnue.");
  }
  const rate = parseRateBp(raw.rateBp);
  errors.push(...rate.errors);
  warnings.push(...rate.warnings);

  const positionText = textOf(raw.position);
  const position = positionText ? Number(positionText) : 0;
  if (!Number.isInteger(position) || position < 0 || position > 999) {
    errors.push("Ordre d'affichage : entier entre 0 et 999 attendu.");
  }

  if (errors.length > 0 || !label.value || rate.value === null) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      code,
      label: label.value,
      base: base as TaxInput["base"],
      rateBp: rate.value,
      position,
    },
    errors,
    warnings,
  };
}

export function validateApurementReference(raw: unknown): {
  value: string | null;
  errors: string[];
} {
  const field = textField(raw, "Référence d'apurement", {
    required: true,
    maxLength: CUSTOMS_MAX_APUREMENT_REFERENCE,
  });
  return { value: field.value, errors: [...field.errors] };
}

export interface ApurementEntryInput {
  readonly lineId: string;
  readonly quantity: string;
  readonly apuredDate: string;
  readonly mode: CustomsApurementMode;
  readonly reference: string;
}

export function validateApurementEntryInput(
  raw: {
    readonly lineId: unknown;
    readonly quantity: unknown;
    readonly apuredDate: unknown;
    readonly mode: unknown;
    readonly reference: unknown;
  },
  today: string = todayIsoDate(),
): { data: ApurementEntryInput | null; errors: string[]; warnings: string[] } {
  const line = uuidField(raw.lineId, "Ligne");
  const quantity = parseQuantity(raw.quantity, "Quantité apurée");
  const date = dateField(raw.apuredDate, "Date d'apurement", true);
  const mode = normalizeApurementMode(raw.mode);
  const reference = textField(raw.reference, "Référence", {
    required: true,
    maxLength: CUSTOMS_MAX_APUREMENT_ENTRY_REFERENCE,
  });

  const errors = [...line.errors, ...quantity.errors, ...date.errors, ...reference.errors];
  const warnings = [...quantity.warnings];
  if (!mode) {
    errors.push("Mode d'apurement : production, exportation, destruction ou transfert attendu.");
  }
  if (date.value && date.value > today) {
    errors.push("Date d'apurement : aujourd'hui au plus tard.");
  }

  if (errors.length > 0 || !line.value || !quantity.value || !date.value || !mode) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      lineId: line.value,
      quantity: quantity.value,
      apuredDate: date.value,
      mode,
      reference: reference.value as string,
    },
    errors,
    warnings,
  };
}
