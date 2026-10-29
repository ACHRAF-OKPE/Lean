import type { FiscalYearStatus, JournalEntryStatus } from "@/db/schema";
import {
  FISCAL_YEAR_STATUS_LABELS,
  JOURNAL_ENTRY_STATUS_LABELS,
} from "@/modules/accounting/constants";

const BASE =
  "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide";

const ENTRY_STATUS_CLASS: Record<JournalEntryStatus, string> = {
  draft: "border-copper/20 bg-copper-soft text-copper",
  validated: "border-brand/20 bg-brand-soft text-brand-strong",
};

const YEAR_STATUS_CLASS: Record<FiscalYearStatus, string> = {
  open: "border-brand/20 bg-brand-soft text-brand-strong",
  closed: "border-line bg-panel text-muted",
};

export function EntryStatusBadge({ status }: { status: JournalEntryStatus }) {
  return (
    <span className={`${BASE} ${ENTRY_STATUS_CLASS[status]}`}>
      {JOURNAL_ENTRY_STATUS_LABELS[status]}
    </span>
  );
}

export function FiscalYearStatusBadge({ status }: { status: FiscalYearStatus }) {
  return (
    <span className={`${BASE} ${YEAR_STATUS_CLASS[status]}`}>
      {FISCAL_YEAR_STATUS_LABELS[status]}
    </span>
  );
}
