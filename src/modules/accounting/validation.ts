import type { AccountingJournalType } from "@/db/schema";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import {
  ACCOUNT_CODE_PATTERN,
  JOURNAL_CODE_PATTERN,
  MAX_FISCAL_YEAR_DAYS,
  MAX_JOURNAL_ENTRY_LINES,
  isAccountingJournalType,
} from "./constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Field<T> {
  readonly value: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function uuidField(raw: unknown, label: string, required = true): Field<string | null> {
  const value = textOf(raw);
  if (!value) {
    return {
      value: null,
      errors: required ? [`${label} : obligatoire.`] : [],
      warnings: [],
    };
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

function dateField(raw: unknown, label: string, required = true): Field<string | null> {
  return parseIsoDate(raw, label, required);
}

function amountField(raw: unknown, label: string): Field<number> {
  const text = textOf(raw);
  if (!text) {
    return { value: 0, errors: [], warnings: [] };
  }
  return parseXofPrice(text, label);
}

function isActive(raw: unknown, fallback = true): boolean {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  return raw !== false && raw !== "false" && raw !== "off" && raw !== "0";
}

function daySpan(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export interface FiscalYearInput {
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export function validateFiscalYearInput(raw: {
  readonly label: unknown;
  readonly startsOn: unknown;
  readonly endsOn: unknown;
}): { data: FiscalYearInput | null; errors: string[]; warnings: string[] } {
  const label = textField(raw.label, "Libellé de l'exercice", { required: true, maxLength: 60 });
  const startsOn = dateField(raw.startsOn, "Date de début");
  const endsOn = dateField(raw.endsOn, "Date de fin");
  const errors = [...label.errors, ...startsOn.errors, ...endsOn.errors];
  const warnings = [...startsOn.warnings, ...endsOn.warnings];

  if (startsOn.value && endsOn.value) {
    const span = daySpan(startsOn.value, endsOn.value);
    if (span <= 0) {
      errors.push("Exercice : la date de début doit précéder la date de fin.");
    } else if (span > MAX_FISCAL_YEAR_DAYS) {
      errors.push(`Exercice : ${MAX_FISCAL_YEAR_DAYS} jours maximum.`);
    }
  }

  if (errors.length > 0 || !label.value || !startsOn.value || !endsOn.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: { label: label.value, startsOn: startsOn.value, endsOn: endsOn.value },
    errors,
    warnings,
  };
}

export interface AccountInput {
  readonly code: string;
  readonly label: string;
  readonly active: boolean;
}

export function accountClassOf(code: string): number | null {
  if (!ACCOUNT_CODE_PATTERN.test(code)) {
    return null;
  }
  return Number(code.slice(0, 1));
}

export function validateAccountInput(raw: {
  readonly code: unknown;
  readonly label: unknown;
  readonly active?: unknown;
}): { data: AccountInput | null; errors: string[]; warnings: string[] } {
  const text = textOf(raw.code);
  const code = text.replace(/[\s\u00a0\u202f]/g, "");
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!code) {
    errors.push("Code du compte : obligatoire.");
  } else {
    if (code !== text) {
      warnings.push("Code du compte : espaces de séparation retirés.");
    }
    if (typeof raw.code === "number") {
      warnings.push("Code du compte lu comme un nombre : vérifiez sa saisie.");
    }
    if (!ACCOUNT_CODE_PATTERN.test(code)) {
      errors.push("Code du compte : 2 à 10 chiffres commençant par une classe de 1 à 8 attendu.");
    }
  }
  const label = textField(raw.label, "Libellé du compte", { required: true, maxLength: 120 });
  errors.push(...label.errors);
  if (errors.length > 0 || !label.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: { code, label: label.value, active: isActive(raw.active) },
    errors,
    warnings,
  };
}

export interface JournalInput {
  readonly code: string;
  readonly label: string;
  readonly type: AccountingJournalType;
  readonly active: boolean;
}

export function validateJournalInput(raw: {
  readonly code: unknown;
  readonly label: unknown;
  readonly type: unknown;
  readonly active?: unknown;
}): { data: JournalInput | null; errors: string[]; warnings: string[] } {
  const text = textOf(raw.code);
  const code = text.toUpperCase();
  const type = textOf(raw.type);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!code) {
    errors.push("Code du journal : obligatoire.");
  } else {
    if (code !== text) {
      warnings.push("Code du journal : normalisé en majuscules.");
    }
    if (!JOURNAL_CODE_PATTERN.test(code)) {
      errors.push("Code du journal : 2 à 6 caractères alphanumériques attendus.");
    }
  }
  const label = textField(raw.label, "Libellé du journal", { required: true, maxLength: 120 });
  errors.push(...label.errors);
  if (!isAccountingJournalType(type)) {
    errors.push("Type du journal : valeur inconnue.");
  }
  if (errors.length > 0 || !label.value || !isAccountingJournalType(type)) {
    return { data: null, errors, warnings };
  }
  return {
    data: { code, label: label.value, type, active: isActive(raw.active) },
    errors,
    warnings,
  };
}

export interface EntryHeaderInput {
  readonly journalId: string;
  readonly entryDate: string;
  readonly reference: string | null;
  readonly label: string;
}

export function validateEntryHeader(raw: {
  readonly journalId: unknown;
  readonly entryDate: unknown;
  readonly reference: unknown;
  readonly label: unknown;
}): { data: EntryHeaderInput | null; errors: string[]; warnings: string[] } {
  const journal = uuidField(raw.journalId, "Journal");
  const date = dateField(raw.entryDate, "Date de l'écriture");
  const reference = textField(raw.reference, "Pièce", { maxLength: 60 });
  const label = textField(raw.label, "Libellé de l'écriture", {
    required: true,
    maxLength: 160,
  });
  const errors = [...journal.errors, ...date.errors, ...reference.errors, ...label.errors];
  const warnings = [...date.warnings];

  if (errors.length > 0 || !journal.value || !date.value || !label.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      journalId: journal.value,
      entryDate: date.value,
      reference: reference.value,
      label: label.value,
    },
    errors,
    warnings,
  };
}

export interface EntryLineInput {
  readonly accountId: string;
  readonly partnerId: string | null;
  readonly label: string | null;
  readonly debit: number;
  readonly credit: number;
}

export function validateEntryLine(raw: {
  readonly accountId: unknown;
  readonly partnerId?: unknown;
  readonly label?: unknown;
  readonly debit: unknown;
  readonly credit: unknown;
}): { data: EntryLineInput | null; errors: string[]; warnings: string[] } {
  const account = uuidField(raw.accountId, "Compte");
  const partner = uuidField(raw.partnerId, "Tiers", false);
  const label = textField(raw.label, "Libellé de ligne", { maxLength: 120 });
  const debit = amountField(raw.debit, "Débit");
  const credit = amountField(raw.credit, "Crédit");
  const errors = [
    ...account.errors,
    ...partner.errors,
    ...label.errors,
    ...debit.errors,
    ...credit.errors,
  ];
  const warnings = [...debit.warnings, ...credit.warnings];

  if (debit.value > 0 && credit.value > 0) {
    errors.push("Débit et crédit : un seul montant par ligne.");
  } else if (debit.value === 0 && credit.value === 0) {
    errors.push("Débit ou crédit : un montant strictement positif attendu.");
  }

  if (errors.length > 0 || !account.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      accountId: account.value,
      partnerId: partner.value,
      label: label.value,
      debit: debit.value,
      credit: credit.value,
    },
    errors,
    warnings,
  };
}

export function entryTotals(lines: readonly EntryLineInput[]): {
  readonly debit: number;
  readonly credit: number;
  readonly balanced: boolean;
} {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += line.debit;
    credit += line.credit;
  }
  return { debit, credit, balanced: debit === credit };
}

export interface JournalEntryInput {
  readonly header: EntryHeaderInput;
  readonly lines: readonly EntryLineInput[];
}

export interface JournalEntryRawLine {
  readonly accountId: unknown;
  readonly partnerId?: unknown;
  readonly label?: unknown;
  readonly debit: unknown;
  readonly credit: unknown;
}

export function validateJournalEntry(raw: {
  readonly journalId: unknown;
  readonly entryDate: unknown;
  readonly reference: unknown;
  readonly label: unknown;
  readonly lines: readonly JournalEntryRawLine[];
}): { data: JournalEntryInput | null; errors: string[]; warnings: string[] } {
  const header = validateEntryHeader(raw);
  const errors = [...header.errors];
  const warnings = [...header.warnings];
  const lines: EntryLineInput[] = [];

  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    errors.push("Écriture : au moins deux lignes attendues.");
  } else if (raw.lines.length > MAX_JOURNAL_ENTRY_LINES) {
    errors.push(`Écriture : ${MAX_JOURNAL_ENTRY_LINES} lignes maximum.`);
  } else {
    raw.lines.forEach((line, index) => {
      const result = validateEntryLine(line);
      result.errors.forEach((message) => errors.push(`Ligne ${index + 1} : ${message}`));
      result.warnings.forEach((message) => warnings.push(`Ligne ${index + 1} : ${message}`));
      if (result.data) {
        lines.push(result.data);
      }
    });
    if (errors.length === 0 && lines.length < 2) {
      errors.push("Écriture : au moins deux lignes attendues.");
    }
  }

  if (errors.length === 0) {
    const totals = entryTotals(lines);
    if (!totals.balanced) {
      errors.push(
        `Écriture déséquilibrée : débit ${totals.debit} XOF, crédit ${totals.credit} XOF.`,
      );
    }
  }

  if (errors.length > 0 || !header.data || lines.length === 0) {
    return { data: null, errors, warnings };
  }
  return { data: { header: header.data, lines }, errors, warnings };
}

export function isWithinRange(date: string, startsOn: string, endsOn: string): boolean {
  return date >= startsOn && date <= endsOn;
}
