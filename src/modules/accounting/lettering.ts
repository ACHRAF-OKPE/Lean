import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  journalEntries,
  journalEntryLineLetterings,
  journalEntryLines,
  ledgerAccounts,
  letteringSequences,
  partners,
} from "@/db/schema";
import { ACCOUNTING_LIST_LIMIT, MAX_JOURNAL_ENTRY_SEQUENCE } from "./constants";
import { AccountingError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERING_CODE_PATTERN = /^L[0-9]{4}$/;

export interface LetteringCandidateLine {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly partnerId: string | null;
  readonly partnerName: string | null;
  readonly label: string | null;
  readonly debit: number;
  readonly credit: number;
}

export async function getLetteringCandidates(
  db: Database,
  tenantId: string,
): Promise<LetteringCandidateLine[]> {
  const rows = await db
    .select({
      lineId: journalEntryLines.id,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
      entryDate: journalEntries.entryDate,
      accountId: journalEntryLines.accountId,
      accountCode: ledgerAccounts.code,
      partnerId: journalEntryLines.partnerId,
      partnerName: partners.name,
      label: journalEntryLines.label,
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
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .leftJoin(
      partners,
      and(
        eq(partners.tenantId, journalEntryLines.tenantId),
        eq(partners.id, journalEntryLines.partnerId),
      ),
    )
    .leftJoin(
      journalEntryLineLetterings,
      and(
        eq(journalEntryLineLetterings.tenantId, journalEntryLines.tenantId),
        eq(journalEntryLineLetterings.lineId, journalEntryLines.id),
      ),
    )
    .where(
      and(
        eq(journalEntryLines.tenantId, tenantId),
        eq(journalEntries.status, "validated"),
        eq(ledgerAccounts.accountClass, 4),
        isNull(journalEntryLineLetterings.id),
      ),
    )
    .orderBy(
      asc(ledgerAccounts.code),
      asc(journalEntries.entryDate),
      asc(journalEntries.number),
      asc(journalEntryLines.lineNumber),
    )
    .limit(ACCOUNTING_LIST_LIMIT);
  return rows;
}

export interface LetteringGroup {
  readonly code: string;
  readonly accountCode: string;
  readonly partnerName: string | null;
  readonly lineCount: number;
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly letteredAt: Date;
}

export async function getLetteringGroups(
  db: Database,
  tenantId: string,
): Promise<LetteringGroup[]> {
  const rows = await db
    .select({
      code: journalEntryLineLetterings.code,
      accountCode: ledgerAccounts.code,
      partnerName: partners.name,
      lineCount: sql<number>`count(*)::int`,
      totalDebit: sql<number>`coalesce(sum(${journalEntryLines.debit}), 0)::bigint`,
      totalCredit: sql<number>`coalesce(sum(${journalEntryLines.credit}), 0)::bigint`,
      letteredAt: sql<Date>`max(${journalEntryLineLetterings.createdAt})`,
    })
    .from(journalEntryLineLetterings)
    .innerJoin(
      journalEntryLines,
      and(
        eq(journalEntryLines.tenantId, journalEntryLineLetterings.tenantId),
        eq(journalEntryLines.id, journalEntryLineLetterings.lineId),
      ),
    )
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .leftJoin(
      partners,
      and(
        eq(partners.tenantId, journalEntryLines.tenantId),
        eq(partners.id, journalEntryLines.partnerId),
      ),
    )
    .where(eq(journalEntryLineLetterings.tenantId, tenantId))
    .groupBy(journalEntryLineLetterings.code, ledgerAccounts.code, partners.name)
    .orderBy(desc(journalEntryLineLetterings.code))
    .limit(ACCOUNTING_LIST_LIMIT);
  return rows.map((row) => ({
    ...row,
    totalDebit: Number(row.totalDebit),
    totalCredit: Number(row.totalCredit),
  }));
}

async function nextLetteringCode(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx
    .insert(letteringSequences)
    .values({ tenantId, lastValue: 1 })
    .onConflictDoUpdate({
      target: letteringSequences.tenantId,
      set: {
        lastValue: sql`${letteringSequences.lastValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastValue: letteringSequences.lastValue });
  const value = row?.lastValue ?? 0;
  if (value < 1 || value > MAX_JOURNAL_ENTRY_SEQUENCE) {
    throw new AccountingError("La séquence de lettrage est épuisée (L9999 atteint).");
  }
  return `L${String(value).padStart(4, "0")}`;
}

export interface LetterLinesInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly lineIds: readonly string[];
}

export interface LetterLinesResult {
  readonly code: string;
  readonly lineCount: number;
  readonly amountXof: number;
}

export async function letterLines(
  db: Database,
  input: LetterLinesInput,
): Promise<LetterLinesResult> {
  const lineIds = [...new Set(input.lineIds.map((id) => String(id).trim()))];
  if (lineIds.length < 2) {
    throw new AccountingError("Le lettrage exige au moins deux lignes.");
  }
  if (lineIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new AccountingError("Lettrage : référence de ligne invalide.");
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        lineId: journalEntryLines.id,
        entryId: journalEntries.id,
        entryStatus: journalEntries.status,
        entryNumber: journalEntries.number,
        accountId: journalEntryLines.accountId,
        accountClass: ledgerAccounts.accountClass,
        accountCode: ledgerAccounts.code,
        partnerId: journalEntryLines.partnerId,
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
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
          eq(ledgerAccounts.id, journalEntryLines.accountId),
        ),
      )
      .where(
        and(eq(journalEntryLines.tenantId, input.tenantId), inArray(journalEntryLines.id, lineIds)),
      )
      .for("update", { of: journalEntryLines });

    if (rows.length !== lineIds.length) {
      throw new AccountingError("Lettrage : une ligne sélectionnée est introuvable.");
    }
    for (const row of rows) {
      if (row.entryStatus !== "validated") {
        throw new AccountingError(
          `Lettre ${row.entryNumber} : seules les écritures validées peuvent être lettrées.`,
        );
      }
      if (row.accountClass !== 4) {
        throw new AccountingError(
          `Lettre ${row.entryNumber} : le lettrage exige un compte de tiers (classe 4).`,
        );
      }
    }
    const accountIds = new Set(rows.map((row) => row.accountId));
    if (accountIds.size !== 1) {
      throw new AccountingError("Le lettrage exige un seul compte de tiers.");
    }
    const partnerIds = new Set(rows.map((row) => row.partnerId ?? ""));
    if (partnerIds.size !== 1) {
      throw new AccountingError("Le lettrage exige un seul tiers.");
    }
    const partnerId = rows[0]?.partnerId ?? null;

    const alreadyLettered = await tx
      .select({ lineId: journalEntryLineLetterings.lineId })
      .from(journalEntryLineLetterings)
      .where(
        and(
          eq(journalEntryLineLetterings.tenantId, input.tenantId),
          inArray(journalEntryLineLetterings.lineId, lineIds),
        ),
      );
    if (alreadyLettered.length > 0) {
      throw new AccountingError("Lettrage refusé : une ligne sélectionnée est déjà lettrée.");
    }

    let debit = 0;
    let credit = 0;
    for (const row of rows) {
      debit += row.debit;
      credit += row.credit;
    }
    if (debit !== credit) {
      throw new AccountingError(
        `Lettrage déséquilibré : débit ${debit} XOF, crédit ${credit} XOF.`,
      );
    }
    if (debit <= 0) {
      throw new AccountingError("Lettrage : les montants doivent être strictement positifs.");
    }

    const code = await nextLetteringCode(tx, input.tenantId);
    await tx.insert(journalEntryLineLetterings).values(
      lineIds.map((lineId) => ({
        tenantId: input.tenantId,
        lineId,
        code,
        letteredByUserId: input.actorUserId,
      })),
    );

    const accountCode = rows[0]?.accountCode ?? "";
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.lettering.create",
      entityType: "journal_entry_line_lettering",
      entityId: code,
      details: {
        code,
        accountCode,
        partnerId,
        lineCount: lineIds.length,
        amountXof: debit,
        entries: rows.map((row) => row.entryNumber),
      },
    });

    return { code, lineCount: lineIds.length, amountXof: debit };
  });
}

export interface UnletterInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly code: unknown;
}

export async function unletterGroup(
  db: Database,
  input: UnletterInput,
): Promise<{ code: string; lineCount: number }> {
  const code = input.code === null || input.code === undefined ? "" : String(input.code).trim();
  if (!LETTERING_CODE_PATTERN.test(code)) {
    throw new AccountingError("Délettrage : code de lettrage invalide.");
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: journalEntryLineLetterings.id,
        lineId: journalEntryLineLetterings.lineId,
        accountId: journalEntryLines.accountId,
        accountCode: ledgerAccounts.code,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
      })
      .from(journalEntryLineLetterings)
      .innerJoin(
        journalEntryLines,
        and(
          eq(journalEntryLines.tenantId, journalEntryLineLetterings.tenantId),
          eq(journalEntryLines.id, journalEntryLineLetterings.lineId),
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
          eq(journalEntryLineLetterings.tenantId, input.tenantId),
          eq(journalEntryLineLetterings.code, code),
        ),
      )
      .for("update");

    if (rows.length === 0) {
      throw new AccountingError(`Délettrage : aucun lettrage ${code} dans cet espace.`);
    }

    await tx
      .delete(journalEntryLineLetterings)
      .where(
        and(
          eq(journalEntryLineLetterings.tenantId, input.tenantId),
          eq(journalEntryLineLetterings.code, code),
        ),
      );

    let amount = 0;
    for (const row of rows) {
      amount += row.debit;
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.lettering.remove",
      entityType: "journal_entry_line_lettering",
      entityId: code,
      details: {
        code,
        accountCode: rows[0]?.accountCode ?? "",
        lineCount: rows.length,
        amountXof: amount,
      },
    });

    return { code, lineCount: rows.length };
  });
}
