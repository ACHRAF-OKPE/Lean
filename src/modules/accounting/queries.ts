import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accountingJournals,
  auditEvents,
  fiscalYears,
  journalEntries,
  journalEntryLineLetterings,
  journalEntryLines,
  ledgerAccounts,
  partners,
  tenants,
  type AccountingJournalType,
  type FiscalYearStatus,
  type JournalEntrySource,
  type JournalEntryStatus,
} from "@/db/schema";
import { ACCOUNTING_LIST_LIMIT, LEDGER_LINE_LIMIT } from "./constants";
import {
  hasBalanceSheetActivity,
  hasResultActivity,
  nextIsoDay,
  planClosingEntry,
  planOpeningEntry,
  summarizeResult,
  type AccountBalance,
} from "./closing";
import { countUnpostedDocuments } from "./cutoff";
import { AccountingError } from "./errors";
import { loadAccountingSettings } from "./settings";
import { nextJournalEntryNumber } from "./sequences";
import {
  accountClassOf,
  entryTotals,
  validateAccountInput,
  validateFiscalYearInput,
  validateJournalEntry as validateEntryInput,
  validateJournalInput,
  type EntryLineInput,
} from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertValid<T>(
  result: { data: T | null; errors: readonly string[] },
  fallback: string,
): T {
  if (!result.data || result.errors.length > 0) {
    throw new AccountingError(result.errors[0] ?? fallback);
  }
  return result.data;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

export interface FiscalYearSummary {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: FiscalYearStatus;
  readonly closedAt: Date | null;
}

export interface LedgerAccountSummary {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
  readonly active: boolean;
}

export interface AccountingJournalSummary {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly type: AccountingJournalType;
  readonly active: boolean;
}

export interface JournalEntrySummary {
  readonly id: string;
  readonly number: string;
  readonly entryDate: string;
  readonly reference: string | null;
  readonly label: string;
  readonly status: JournalEntryStatus;
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly journalCode: string;
  readonly journalLabel: string;
  readonly fiscalYearLabel: string;
}

export interface JournalEntryLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly partnerId: string | null;
  readonly partnerName: string | null;
  readonly label: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly letteringCode: string | null;
}

export interface JournalEntryDetail extends JournalEntrySummary {
  readonly fiscalYearId: string;
  readonly journalId: string;
  readonly source: JournalEntrySource;
  readonly sourceId: string | null;
  readonly lines: readonly JournalEntryLineDetail[];
}

export interface BalanceRow {
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
  readonly debit: number;
  readonly credit: number;
  readonly balance: number;
}

export interface BalanceReport {
  readonly fiscalYear: FiscalYearSummary;
  readonly rows: readonly BalanceRow[];
  readonly totalDebit: number;
  readonly totalCredit: number;
}

export interface LedgerLine {
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly entryLabel: string;
  readonly lineNumber: number;
  readonly lineLabel: string | null;
  readonly partnerName: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly runningBalance: number;
}

export interface LedgerReport {
  readonly account: LedgerAccountSummary;
  readonly fiscalYear: FiscalYearSummary;
  readonly lines: readonly LedgerLine[];
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly balance: number;
  readonly truncated: boolean;
}

export interface AccountingOverview {
  readonly accountCount: number;
  readonly journalCount: number;
  readonly draftCount: number;
  readonly validatedCount: number;
  readonly openFiscalYear: FiscalYearSummary | null;
}

function fiscalYearSummary(row: {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: FiscalYearStatus;
  closedAt: Date | null;
}): FiscalYearSummary {
  return {
    id: row.id,
    label: row.label,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    closedAt: row.closedAt,
  };
}

export async function listFiscalYears(
  db: Database,
  tenantId: string,
): Promise<readonly FiscalYearSummary[]> {
  const rows = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
      closedAt: fiscalYears.closedAt,
    })
    .from(fiscalYears)
    .where(eq(fiscalYears.tenantId, tenantId))
    .orderBy(desc(fiscalYears.startsOn));
  return rows.map(fiscalYearSummary);
}

export async function listOpenFiscalYears(
  db: Database,
  tenantId: string,
): Promise<readonly FiscalYearSummary[]> {
  const rows = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
      closedAt: fiscalYears.closedAt,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.status, "open")))
    .orderBy(desc(fiscalYears.startsOn));
  return rows.map(fiscalYearSummary);
}

export async function createFiscalYear(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: { label: unknown; startsOn: unknown; endsOn: unknown };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateFiscalYearInput(input.raw), "Exercice invalide.");
  return db.transaction(async (tx) => {
    await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .for("update");

    const [overlap] = await tx
      .select({ id: fiscalYears.id, label: fiscalYears.label })
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.tenantId, input.tenantId),
          lte(fiscalYears.startsOn, data.endsOn),
          gte(fiscalYears.endsOn, data.startsOn),
        ),
      )
      .limit(1);
    if (overlap) {
      throw new AccountingError(
        `L'exercice ${data.label} chevauche l'exercice ${overlap.label} : les périodes ne peuvent pas se recouvrir.`,
      );
    }

    const [created] = await tx
      .insert(fiscalYears)
      .values({
        tenantId: input.tenantId,
        label: data.label,
        startsOn: data.startsOn,
        endsOn: data.endsOn,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: fiscalYears.id });
    if (!created) {
      throw new AccountingError("L'exercice n'a pas pu être créé.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.fiscal_year.create",
      entityType: "fiscal_year",
      entityId: created.id,
      details: { label: data.label, startsOn: data.startsOn, endsOn: data.endsOn },
    });
    return created;
  });
}

async function yearAccountBalances(
  tx: Transaction,
  tenantId: string,
  fiscalYearId: string,
): Promise<readonly AccountBalance[]> {
  const rows = await tx
    .select({
      accountId: ledgerAccounts.id,
      code: ledgerAccounts.code,
      label: ledgerAccounts.label,
      accountClass: ledgerAccounts.accountClass,
      debit: sql<string>`sum(${journalEntryLines.debit})`,
      credit: sql<string>`sum(${journalEntryLines.credit})`,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, journalEntryLines.tenantId),
        eq(journalEntries.id, journalEntryLines.entryId),
      ),
    )
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .where(
      and(
        eq(journalEntryLines.tenantId, tenantId),
        eq(journalEntries.fiscalYearId, fiscalYearId),
        eq(journalEntries.status, "validated"),
      ),
    )
    .groupBy(
      ledgerAccounts.id,
      ledgerAccounts.code,
      ledgerAccounts.label,
      ledgerAccounts.accountClass,
    )
    .orderBy(asc(ledgerAccounts.code));
  return rows.map((row) => ({ ...row, debit: Number(row.debit), credit: Number(row.credit) }));
}

async function activeMiscJournal(
  tx: Transaction,
  tenantId: string,
): Promise<{ id: string; code: string }> {
  const [journal] = await tx
    .select({ id: accountingJournals.id, code: accountingJournals.code })
    .from(accountingJournals)
    .where(
      and(
        eq(accountingJournals.tenantId, tenantId),
        eq(accountingJournals.type, "misc"),
        eq(accountingJournals.active, true),
      ),
    )
    .orderBy(asc(accountingJournals.code))
    .limit(1);
  if (!journal) {
    throw new AccountingError(
      "Clôture refusée : aucun journal de type divers actif. Créez-en un dans Journaux pour solder l'exercice.",
    );
  }
  return journal;
}

async function resultAccountFor(
  tx: Transaction,
  tenantId: string,
  prefix: "131" | "139",
): Promise<{ id: string; code: string }> {
  const rows = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.tenantId, tenantId),
        eq(ledgerAccounts.accountClass, 1),
        eq(ledgerAccounts.active, true),
        sql`${ledgerAccounts.code} like ${`${prefix}%`}`,
      ),
    )
    .orderBy(asc(ledgerAccounts.code));
  if (rows.length === 0) {
    throw new AccountingError(
      `Clôture refusée : créez et activez le compte ${prefix} (${prefix === "131" ? "résultat net : bénéfice" : "résultat net : perte"}) dans le plan comptable.`,
    );
  }
  if (rows.length > 1) {
    throw new AccountingError(
      `Clôture refusée : plusieurs comptes actifs commencent par ${prefix} (${rows.map((row) => row.code).join(", ")}). Laissez-en un seul actif.`,
    );
  }
  const account = rows[0];
  if (!account) {
    throw new AccountingError("Compte de résultat introuvable.");
  }
  return account;
}

export async function closeFiscalYear(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly fiscalYearId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [year] = await tx
      .select({
        id: fiscalYears.id,
        label: fiscalYears.label,
        startsOn: fiscalYears.startsOn,
        endsOn: fiscalYears.endsOn,
        status: fiscalYears.status,
      })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)))
      .limit(1)
      .for("update");
    if (!year) {
      throw new AccountingError("Exercice introuvable dans cet espace.");
    }
    if (year.status === "closed") {
      throw new AccountingError(`L'exercice ${year.label} est déjà clôturé.`);
    }

    const [draft] = await tx
      .select({ value: count() })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, input.tenantId),
          eq(journalEntries.fiscalYearId, year.id),
          eq(journalEntries.status, "draft"),
        ),
      );
    const draftCount = draft?.value ?? 0;
    if (draftCount > 0) {
      throw new AccountingError(
        `Clôture refusée : ${draftCount} écriture${draftCount > 1 ? "s" : ""} en brouillon sur l'exercice ${year.label}. Validez-les ou supprimez-les d'abord.`,
      );
    }

    const settings = await loadAccountingSettings(tx, input.tenantId);
    if (settings) {
      const unposted = await countUnpostedDocuments(tx, {
        tenantId: input.tenantId,
        fiscalYearId: year.id,
      });
      if (unposted.total > 0) {
        const parts: string[] = [];
        if (unposted.invoices > 0) {
          parts.push(`${unposted.invoices} facture${unposted.invoices > 1 ? "s" : ""}`);
        }
        if (unposted.payments > 0) {
          parts.push(`${unposted.payments} règlement${unposted.payments > 1 ? "s" : ""}`);
        }
        if (unposted.receptions > 0) {
          parts.push(`${unposted.receptions} réception${unposted.receptions > 1 ? "s" : ""}`);
        }
        throw new AccountingError(
          `Clôture refusée : ${unposted.total} document${unposted.total > 1 ? "s" : ""} daté${unposted.total > 1 ? "s" : ""} dans l'exercice ${year.label} ne sont pas comptabilisés (${parts.join(", ")}). Comptabilisez-les depuis le rapprochement avant de clôturer.`,
        );
      }
    }

    const balances = await yearAccountBalances(tx, input.tenantId, year.id);
    const resultActivity = hasResultActivity(balances);
    const balanceSheetActivity = hasBalanceSheetActivity(balances);
    const summary = summarizeResult(balances);

    let journal: { id: string; code: string } | null = null;
    if (resultActivity || balanceSheetActivity) {
      journal = await activeMiscJournal(tx, input.tenantId);
    }

    let closing: InsertJournalEntryResult | null = null;
    if (resultActivity && journal) {
      const resultAccount =
        summary.result === 0
          ? null
          : await resultAccountFor(tx, input.tenantId, summary.result > 0 ? "131" : "139");
      closing = await insertJournalEntry(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        journalId: journal.id,
        journalCode: journal.code,
        fiscalYearId: year.id,
        fiscalYearLabel: year.label,
        entryDate: year.endsOn,
        reference: year.label,
        label: `Clôture ${year.label}`,
        lines: planClosingEntry(balances, resultAccount),
        source: "fiscal_year_close",
        sourceId: year.id,
        validated: true,
      });
    }

    let opening: InsertJournalEntryResult | null = null;
    if (journal) {
      const balancesAtClose = closing
        ? await yearAccountBalances(tx, input.tenantId, year.id)
        : balances;
      const openingLines = planOpeningEntry(balancesAtClose);
      if (openingLines.length > 0) {
        const nextStart = nextIsoDay(year.endsOn);
        const [nextYear] = await tx
          .select({ id: fiscalYears.id, label: fiscalYears.label, startsOn: fiscalYears.startsOn })
          .from(fiscalYears)
          .where(
            and(
              eq(fiscalYears.tenantId, input.tenantId),
              eq(fiscalYears.status, "open"),
              eq(fiscalYears.startsOn, nextStart),
            ),
          )
          .limit(1)
          .for("update");
        if (!nextYear) {
          throw new AccountingError(
            `Clôture refusée : aucun exercice ouvert ne commence le ${nextStart}. Créez l'exercice suivant pour reprendre les soldes.`,
          );
        }
        opening = await insertJournalEntry(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          journalId: journal.id,
          journalCode: journal.code,
          fiscalYearId: nextYear.id,
          fiscalYearLabel: nextYear.label,
          entryDate: nextYear.startsOn,
          reference: year.label,
          label: `À-nouveaux ${nextYear.label}`,
          lines: openingLines,
          source: "fiscal_year_open",
          sourceId: year.id,
          validated: true,
        });
      }
    }

    await tx
      .update(fiscalYears)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.fiscal_year.close",
      entityType: "fiscal_year",
      entityId: year.id,
      details: {
        label: year.label,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        charges: summary.charges,
        produits: summary.produits,
        result: summary.result,
        ...(closing ? { closingNumber: closing.number } : {}),
        ...(opening ? { openingNumber: opening.number } : {}),
      },
    });
  });
}

export async function listAccounts(
  db: Database,
  input: { tenantId: string; activeOnly?: boolean },
): Promise<readonly LedgerAccountSummary[]> {
  const filters = [eq(ledgerAccounts.tenantId, input.tenantId)];
  if (input.activeOnly) {
    filters.push(eq(ledgerAccounts.active, true));
  }
  return db
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      label: ledgerAccounts.label,
      accountClass: ledgerAccounts.accountClass,
      active: ledgerAccounts.active,
    })
    .from(ledgerAccounts)
    .where(and(...filters))
    .orderBy(asc(ledgerAccounts.code));
}

export async function createAccount(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: { code: unknown; label: unknown; active?: unknown };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateAccountInput(input.raw), "Compte invalide.");
  const accountClass = accountClassOf(data.code);
  if (accountClass === null) {
    throw new AccountingError("Compte invalide : classe comptable indéterminable.");
  }
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(ledgerAccounts)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          label: data.label,
          accountClass,
          active: data.active,
        })
        .returning({ id: ledgerAccounts.id });
      if (!created) {
        throw new AccountingError("Le compte n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "accounting.account.create",
        entityType: "ledger_account",
        entityId: created.id,
        details: {
          code: data.code,
          label: data.label,
          accountClass,
          active: data.active,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AccountingError(`Le compte ${data.code} existe déjà dans cet espace.`);
    }
    throw error;
  }
}

export async function setAccountActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly accountId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [account] = await tx
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        active: ledgerAccounts.active,
      })
      .from(ledgerAccounts)
      .where(
        and(eq(ledgerAccounts.tenantId, input.tenantId), eq(ledgerAccounts.id, input.accountId)),
      )
      .limit(1)
      .for("update");
    if (!account) {
      throw new AccountingError("Compte introuvable dans cet espace.");
    }
    if (account.active === input.active) {
      return;
    }
    await tx
      .update(ledgerAccounts)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(ledgerAccounts.tenantId, input.tenantId), eq(ledgerAccounts.id, input.accountId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.account.status",
      entityType: "ledger_account",
      entityId: account.id,
      details: { code: account.code, before: account.active, after: input.active },
    });
  });
}

export async function listJournals(
  db: Database,
  input: { tenantId: string; activeOnly?: boolean },
): Promise<readonly AccountingJournalSummary[]> {
  const filters = [eq(accountingJournals.tenantId, input.tenantId)];
  if (input.activeOnly) {
    filters.push(eq(accountingJournals.active, true));
  }
  return db
    .select({
      id: accountingJournals.id,
      code: accountingJournals.code,
      label: accountingJournals.label,
      type: accountingJournals.type,
      active: accountingJournals.active,
    })
    .from(accountingJournals)
    .where(and(...filters))
    .orderBy(asc(accountingJournals.code));
}

export async function createJournal(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: { code: unknown; label: unknown; type: unknown; active?: unknown };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateJournalInput(input.raw), "Journal invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accountingJournals)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          label: data.label,
          type: data.type,
          active: data.active,
        })
        .returning({ id: accountingJournals.id });
      if (!created) {
        throw new AccountingError("Le journal n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "accounting.journal.create",
        entityType: "accounting_journal",
        entityId: created.id,
        details: {
          code: data.code,
          label: data.label,
          type: data.type,
          active: data.active,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AccountingError(`Le journal ${data.code} existe déjà dans cet espace.`);
    }
    throw error;
  }
}

export async function setJournalActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly journalId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [journal] = await tx
      .select({
        id: accountingJournals.id,
        code: accountingJournals.code,
        active: accountingJournals.active,
      })
      .from(accountingJournals)
      .where(
        and(
          eq(accountingJournals.tenantId, input.tenantId),
          eq(accountingJournals.id, input.journalId),
        ),
      )
      .limit(1)
      .for("update");
    if (!journal) {
      throw new AccountingError("Journal introuvable dans cet espace.");
    }
    if (journal.active === input.active) {
      return;
    }
    await tx
      .update(accountingJournals)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(
          eq(accountingJournals.tenantId, input.tenantId),
          eq(accountingJournals.id, input.journalId),
        ),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.journal.status",
      entityType: "accounting_journal",
      entityId: journal.id,
      details: { code: journal.code, before: journal.active, after: input.active },
    });
  });
}

export async function listJournalEntries(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly status?: JournalEntryStatus;
    readonly fiscalYearId?: string;
    readonly journalId?: string;
    readonly limit?: number;
  },
): Promise<readonly JournalEntrySummary[]> {
  const filters = [eq(journalEntries.tenantId, input.tenantId)];
  if (input.status) {
    filters.push(eq(journalEntries.status, input.status));
  }
  if (input.fiscalYearId) {
    filters.push(eq(journalEntries.fiscalYearId, input.fiscalYearId));
  }
  if (input.journalId) {
    filters.push(eq(journalEntries.journalId, input.journalId));
  }
  const limit = Math.min(Math.max(input.limit ?? ACCOUNTING_LIST_LIMIT, 1), ACCOUNTING_LIST_LIMIT);

  return db
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      reference: journalEntries.reference,
      label: journalEntries.label,
      status: journalEntries.status,
      totalDebit: journalEntries.totalDebit,
      totalCredit: journalEntries.totalCredit,
      journalCode: accountingJournals.code,
      journalLabel: accountingJournals.label,
      fiscalYearLabel: fiscalYears.label,
    })
    .from(journalEntries)
    .innerJoin(
      accountingJournals,
      and(
        eq(accountingJournals.tenantId, journalEntries.tenantId),
        eq(accountingJournals.id, journalEntries.journalId),
      ),
    )
    .innerJoin(
      fiscalYears,
      and(
        eq(fiscalYears.tenantId, journalEntries.tenantId),
        eq(fiscalYears.id, journalEntries.fiscalYearId),
      ),
    )
    .where(and(...filters))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.number))
    .limit(limit);
}

export async function getJournalEntry(
  db: Database,
  input: { tenantId: string; entryId: string },
): Promise<JournalEntryDetail | null> {
  const [entry] = await db
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      reference: journalEntries.reference,
      label: journalEntries.label,
      status: journalEntries.status,
      totalDebit: journalEntries.totalDebit,
      totalCredit: journalEntries.totalCredit,
      journalId: journalEntries.journalId,
      fiscalYearId: journalEntries.fiscalYearId,
      source: journalEntries.source,
      sourceId: journalEntries.sourceId,
      journalCode: accountingJournals.code,
      journalLabel: accountingJournals.label,
      fiscalYearLabel: fiscalYears.label,
    })
    .from(journalEntries)
    .innerJoin(
      accountingJournals,
      and(
        eq(accountingJournals.tenantId, journalEntries.tenantId),
        eq(accountingJournals.id, journalEntries.journalId),
      ),
    )
    .innerJoin(
      fiscalYears,
      and(
        eq(fiscalYears.tenantId, journalEntries.tenantId),
        eq(fiscalYears.id, journalEntries.fiscalYearId),
      ),
    )
    .where(and(eq(journalEntries.tenantId, input.tenantId), eq(journalEntries.id, input.entryId)))
    .limit(1);
  if (!entry) {
    return null;
  }

  const lines = await db
    .select({
      id: journalEntryLines.id,
      lineNumber: journalEntryLines.lineNumber,
      accountId: journalEntryLines.accountId,
      accountCode: ledgerAccounts.code,
      accountLabel: ledgerAccounts.label,
      partnerId: journalEntryLines.partnerId,
      partnerName: partners.name,
      label: journalEntryLines.label,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      letteringCode: journalEntryLineLetterings.code,
    })
    .from(journalEntryLines)
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .leftJoin(
      journalEntryLineLetterings,
      and(
        eq(journalEntryLineLetterings.tenantId, journalEntryLines.tenantId),
        eq(journalEntryLineLetterings.lineId, journalEntryLines.id),
      ),
    )
    .leftJoin(
      partners,
      and(
        eq(partners.tenantId, journalEntryLines.tenantId),
        eq(partners.id, journalEntryLines.partnerId),
      ),
    )
    .where(
      and(
        eq(journalEntryLines.tenantId, input.tenantId),
        eq(journalEntryLines.entryId, input.entryId),
      ),
    )
    .orderBy(asc(journalEntryLines.lineNumber));

  return { ...entry, lines };
}

export interface InsertJournalEntryInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly journalId: string;
  readonly journalCode: string;
  readonly fiscalYearId: string;
  readonly fiscalYearLabel: string;
  readonly entryDate: string;
  readonly reference: string | null;
  readonly label: string;
  readonly lines: readonly EntryLineInput[];
  readonly source?: JournalEntrySource;
  readonly sourceId?: string;
  readonly validated?: boolean;
  readonly batchId?: string;
}

export interface InsertJournalEntryResult {
  readonly id: string;
  readonly number: string;
  readonly totalDebit: number;
}

export async function insertJournalEntry(
  tx: Transaction,
  input: InsertJournalEntryInput,
): Promise<InsertJournalEntryResult> {
  const totals = entryTotals(input.lines);
  const number = await nextJournalEntryNumber(tx, {
    tenantId: input.tenantId,
    journalId: input.journalId,
    journalCode: input.journalCode,
    entryDate: input.entryDate,
  });

  const [created] = await tx
    .insert(journalEntries)
    .values({
      tenantId: input.tenantId,
      journalId: input.journalId,
      fiscalYearId: input.fiscalYearId,
      number,
      entryDate: input.entryDate,
      reference: input.reference,
      label: input.label,
      status: input.validated ? "validated" : "draft",
      source: input.source ?? "manual",
      sourceId: input.sourceId ?? null,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      createdByUserId: input.actorUserId,
      validatedByUserId: input.validated ? input.actorUserId : null,
      validatedAt: input.validated ? new Date() : null,
    })
    .returning({ id: journalEntries.id });
  if (!created) {
    throw new AccountingError("L'écriture n'a pas pu être créée.");
  }

  await tx.insert(journalEntryLines).values(
    input.lines.map((line, index) => ({
      tenantId: input.tenantId,
      entryId: created.id,
      lineNumber: index + 1,
      accountId: line.accountId,
      partnerId: line.partnerId,
      label: line.label,
      debit: line.debit,
      credit: line.credit,
    })),
  );

  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "accounting.entry.create",
    entityType: "journal_entry",
    entityId: created.id,
    details: {
      number,
      journalCode: input.journalCode,
      entryDate: input.entryDate,
      label: input.label,
      totalDebit: totals.debit,
      lineCount: input.lines.length,
      fiscalYear: input.fiscalYearLabel,
      source: input.source ?? "manual",
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.batchId ? { batchId: input.batchId } : {}),
    },
  });

  return { id: created.id, number, totalDebit: totals.debit };
}

export async function createJournalEntry(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: {
      journalId: unknown;
      entryDate: unknown;
      reference: unknown;
      label: unknown;
      lines: readonly {
        accountId: unknown;
        partnerId?: unknown;
        label?: unknown;
        debit: unknown;
        credit: unknown;
      }[];
    };
  },
): Promise<{ id: string; number: string }> {
  const data = assertValid(validateEntryInput(input.raw), "Écriture invalide.");

  return db.transaction(async (tx) => {
    const [journal] = await tx
      .select({
        id: accountingJournals.id,
        code: accountingJournals.code,
        active: accountingJournals.active,
      })
      .from(accountingJournals)
      .where(
        and(
          eq(accountingJournals.tenantId, input.tenantId),
          eq(accountingJournals.id, data.header.journalId),
        ),
      )
      .limit(1)
      .for("update");
    if (!journal) {
      throw new AccountingError("Journal introuvable dans cet espace.");
    }
    if (!journal.active) {
      throw new AccountingError(
        `Le journal ${journal.code} est inactif : réactivez-le pour saisir une écriture.`,
      );
    }

    const [year] = await tx
      .select({ id: fiscalYears.id, label: fiscalYears.label })
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.tenantId, input.tenantId),
          eq(fiscalYears.status, "open"),
          lte(fiscalYears.startsOn, data.header.entryDate),
          gte(fiscalYears.endsOn, data.header.entryDate),
        ),
      )
      .limit(1)
      .for("update");
    if (!year) {
      throw new AccountingError(
        `Aucun exercice ouvert ne couvre le ${data.header.entryDate} : créez ou rouvrez l'exercice correspondant.`,
      );
    }

    const accountIds = [...new Set(data.lines.map((line) => line.accountId))];
    const accountRows = await tx
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code, active: ledgerAccounts.active })
      .from(ledgerAccounts)
      .where(
        and(eq(ledgerAccounts.tenantId, input.tenantId), inArray(ledgerAccounts.id, accountIds)),
      );
    const accountsById = new Map(accountRows.map((row) => [row.id, row]));
    for (const line of data.lines) {
      const account = accountsById.get(line.accountId);
      if (!account) {
        throw new AccountingError("Compte introuvable : relancez la saisie.");
      }
      if (!account.active) {
        throw new AccountingError(
          `Le compte ${account.code} est inactif : choisissez un compte actif.`,
        );
      }
    }

    const partnerIds = [
      ...new Set(
        data.lines
          .map((line) => line.partnerId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (partnerIds.length > 0) {
      const partnerRows = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, partnerIds)));
      const known = new Set(partnerRows.map((row) => row.id));
      const missing = partnerIds.find((id) => !known.has(id));
      if (missing) {
        throw new AccountingError("Tiers introuvable : relancez la saisie.");
      }
    }

    const result = await insertJournalEntry(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      journalId: journal.id,
      journalCode: journal.code,
      fiscalYearId: year.id,
      fiscalYearLabel: year.label,
      entryDate: data.header.entryDate,
      reference: data.header.reference,
      label: data.header.label,
      lines: data.lines,
    });

    return { id: result.id, number: result.number };
  });
}

export async function validateJournalEntry(
  db: Database,
  input: { tenantId: string; actorUserId: string; entryId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select({
        id: journalEntries.id,
        number: journalEntries.number,
        status: journalEntries.status,
        totalDebit: journalEntries.totalDebit,
        totalCredit: journalEntries.totalCredit,
      })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, input.tenantId), eq(journalEntries.id, input.entryId)))
      .limit(1)
      .for("update");
    if (!entry) {
      throw new AccountingError("Écriture introuvable dans cet espace.");
    }
    if (entry.status === "validated") {
      throw new AccountingError(`L'écriture ${entry.number} est déjà validée.`);
    }
    if (entry.totalDebit !== entry.totalCredit) {
      throw new AccountingError(
        `Écriture ${entry.number} déséquilibrée : la validation est refusée.`,
      );
    }
    const [lineCount] = await tx
      .select({ value: count() })
      .from(journalEntryLines)
      .where(
        and(
          eq(journalEntryLines.tenantId, input.tenantId),
          eq(journalEntryLines.entryId, entry.id),
        ),
      );
    if ((lineCount?.value ?? 0) < 2) {
      throw new AccountingError(
        `Écriture ${entry.number} : au moins deux lignes sont nécessaires pour la validation.`,
      );
    }

    const now = new Date();
    await tx
      .update(journalEntries)
      .set({
        status: "validated",
        validatedAt: now,
        validatedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(
        and(eq(journalEntries.tenantId, input.tenantId), eq(journalEntries.id, input.entryId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.entry.validate",
      entityType: "journal_entry",
      entityId: entry.id,
      details: { number: entry.number, totalDebit: entry.totalDebit },
    });
  });
}

export async function deleteJournalEntry(
  db: Database,
  input: { tenantId: string; actorUserId: string; entryId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select({
        id: journalEntries.id,
        number: journalEntries.number,
        label: journalEntries.label,
        status: journalEntries.status,
      })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, input.tenantId), eq(journalEntries.id, input.entryId)))
      .limit(1)
      .for("update");
    if (!entry) {
      throw new AccountingError("Écriture introuvable dans cet espace.");
    }
    if (entry.status === "validated") {
      throw new AccountingError(
        `L'écriture ${entry.number} est validée : elle ne peut plus être supprimée.`,
      );
    }
    await tx
      .delete(journalEntries)
      .where(
        and(eq(journalEntries.tenantId, input.tenantId), eq(journalEntries.id, input.entryId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.entry.delete",
      entityType: "journal_entry",
      entityId: entry.id,
      details: { number: entry.number, label: entry.label },
    });
  });
}

export async function getBalanceReport(
  db: Database,
  input: { tenantId: string; fiscalYearId: string },
): Promise<BalanceReport | null> {
  const [year] = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
      closedAt: fiscalYears.closedAt,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)))
    .limit(1);
  if (!year) {
    return null;
  }

  const rows = await db
    .select({
      accountId: ledgerAccounts.id,
      code: ledgerAccounts.code,
      label: ledgerAccounts.label,
      accountClass: ledgerAccounts.accountClass,
      debit: sql<string>`sum(${journalEntryLines.debit})`,
      credit: sql<string>`sum(${journalEntryLines.credit})`,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, journalEntryLines.tenantId),
        eq(journalEntries.id, journalEntryLines.entryId),
      ),
    )
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .where(
      and(
        eq(journalEntryLines.tenantId, input.tenantId),
        eq(journalEntries.fiscalYearId, input.fiscalYearId),
        eq(journalEntries.status, "validated"),
      ),
    )
    .groupBy(
      ledgerAccounts.id,
      ledgerAccounts.code,
      ledgerAccounts.label,
      ledgerAccounts.accountClass,
    )
    .orderBy(asc(ledgerAccounts.code));

  let totalDebit = 0;
  let totalCredit = 0;
  const mapped = rows.map((row) => {
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    totalDebit += debit;
    totalCredit += credit;
    return {
      accountId: row.accountId,
      code: row.code,
      label: row.label,
      accountClass: row.accountClass,
      debit,
      credit,
      balance: debit - credit,
    } satisfies BalanceRow;
  });

  return { fiscalYear: fiscalYearSummary(year), rows: mapped, totalDebit, totalCredit };
}

export async function getLedgerReport(
  db: Database,
  input: { tenantId: string; accountId: string; fiscalYearId: string },
): Promise<LedgerReport | null> {
  const [account] = await db
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      label: ledgerAccounts.label,
      accountClass: ledgerAccounts.accountClass,
      active: ledgerAccounts.active,
    })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.tenantId, input.tenantId), eq(ledgerAccounts.id, input.accountId)))
    .limit(1);
  if (!account) {
    return null;
  }

  const [year] = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
      closedAt: fiscalYears.closedAt,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)))
    .limit(1);
  if (!year) {
    return null;
  }

  const rows = await db
    .select({
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
      entryDate: journalEntries.entryDate,
      entryLabel: journalEntries.label,
      lineNumber: journalEntryLines.lineNumber,
      lineLabel: journalEntryLines.label,
      partnerName: partners.name,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, journalEntryLines.tenantId),
        eq(journalEntries.id, journalEntryLines.entryId),
      ),
    )
    .leftJoin(
      partners,
      and(
        eq(partners.tenantId, journalEntryLines.tenantId),
        eq(partners.id, journalEntryLines.partnerId),
      ),
    )
    .where(
      and(
        eq(journalEntryLines.tenantId, input.tenantId),
        eq(journalEntryLines.accountId, input.accountId),
        eq(journalEntries.fiscalYearId, input.fiscalYearId),
        eq(journalEntries.status, "validated"),
      ),
    )
    .orderBy(
      asc(journalEntries.entryDate),
      asc(journalEntries.number),
      asc(journalEntryLines.lineNumber),
    )
    .limit(LEDGER_LINE_LIMIT + 1);

  const truncated = rows.length > LEDGER_LINE_LIMIT;
  const visible = truncated ? rows.slice(0, LEDGER_LINE_LIMIT) : rows;

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = visible.map((row) => {
    running += row.debit - row.credit;
    totalDebit += row.debit;
    totalCredit += row.credit;
    return {
      entryId: row.entryId,
      entryNumber: row.entryNumber,
      entryDate: row.entryDate,
      entryLabel: row.entryLabel,
      lineNumber: row.lineNumber,
      lineLabel: row.lineLabel,
      partnerName: row.partnerName,
      debit: row.debit,
      credit: row.credit,
      runningBalance: running,
    } satisfies LedgerLine;
  });

  return {
    account,
    fiscalYear: fiscalYearSummary(year),
    lines,
    totalDebit,
    totalCredit,
    balance: totalDebit - totalCredit,
    truncated,
  };
}

export async function getAccountingOverview(
  db: Database,
  tenantId: string,
): Promise<AccountingOverview> {
  const [accounts, journals, drafts, validated, openYear] = await Promise.all([
    db.select({ value: count() }).from(ledgerAccounts).where(eq(ledgerAccounts.tenantId, tenantId)),
    db
      .select({ value: count() })
      .from(accountingJournals)
      .where(eq(accountingJournals.tenantId, tenantId)),
    db
      .select({ value: count() })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.status, "draft"))),
    db
      .select({ value: count() })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.status, "validated"))),
    db
      .select({
        id: fiscalYears.id,
        label: fiscalYears.label,
        startsOn: fiscalYears.startsOn,
        endsOn: fiscalYears.endsOn,
        status: fiscalYears.status,
        closedAt: fiscalYears.closedAt,
      })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.status, "open")))
      .orderBy(desc(fiscalYears.startsOn))
      .limit(1),
  ]);

  return {
    accountCount: accounts[0]?.value ?? 0,
    journalCount: journals[0]?.value ?? 0,
    draftCount: drafts[0]?.value ?? 0,
    validatedCount: validated[0]?.value ?? 0,
    openFiscalYear: openYear[0] ? fiscalYearSummary(openYear[0]) : null,
  };
}
