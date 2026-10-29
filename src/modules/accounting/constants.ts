import type { AccountingJournalType, FiscalYearStatus, JournalEntryStatus } from "@/db/schema";

export const FISCAL_YEAR_STATUSES = ["open", "closed"] as const;

export const FISCAL_YEAR_STATUS_LABELS: Record<FiscalYearStatus, string> = {
  open: "Ouvert",
  closed: "Clôturé",
};

export const ACCOUNTING_JOURNAL_TYPES = ["sale", "purchase", "bank", "cash", "misc"] as const;

export const ACCOUNTING_JOURNAL_TYPE_LABELS: Record<AccountingJournalType, string> = {
  sale: "Vente",
  purchase: "Achat",
  bank: "Banque",
  cash: "Caisse",
  misc: "Opérations diverses",
};

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  draft: "Brouillon",
  validated: "Validée",
};

export const ACCOUNT_CODE_PATTERN = /^[1-8][0-9]{1,9}$/;
export const JOURNAL_CODE_PATTERN = /^[A-Z0-9]{2,6}$/;
export const MAX_XOF_AMOUNT = 2_000_000_000;
export const MAX_FISCAL_YEAR_DAYS = 366;
export const MAX_JOURNAL_ENTRY_LINES = 50;
export const MAX_JOURNAL_ENTRY_SEQUENCE = 9999;
export const ACCOUNTING_LIST_LIMIT = 200;
export const LEDGER_LINE_LIMIT = 500;

export function isAccountingJournalType(value: string): value is AccountingJournalType {
  return (ACCOUNTING_JOURNAL_TYPES as readonly string[]).includes(value);
}

export function isFiscalYearStatus(value: string): value is FiscalYearStatus {
  return (FISCAL_YEAR_STATUSES as readonly string[]).includes(value);
}
