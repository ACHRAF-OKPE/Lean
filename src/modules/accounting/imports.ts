import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accountingJournals,
  auditEvents,
  fiscalYears,
  importRows,
  ledgerAccounts,
  partners,
} from "@/db/schema";
import type { ValidationContext } from "@/modules/catalog/validation";
import { AccountingError } from "./errors";
import type { AccountImportData, JournalEntryImportData } from "./import-validation";
import { accountClassOf } from "./validation";
import { insertJournalEntry } from "./queries";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

export interface ApplyAccountingImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

export interface ApplyJournalEntryImportResult {
  readonly entries: number;
  readonly written: number;
}

export async function loadAccountingImportContext(
  db: Database,
  tenantId: string,
): Promise<Partial<ValidationContext>> {
  const [accounts, journals, partnerRows, openYears] = await Promise.all([
    db
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code, active: ledgerAccounts.active })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenantId)),
    db
      .select({
        id: accountingJournals.id,
        code: accountingJournals.code,
        active: accountingJournals.active,
      })
      .from(accountingJournals)
      .where(eq(accountingJournals.tenantId, tenantId)),
    db
      .select({ id: partners.id, code: partners.code })
      .from(partners)
      .where(eq(partners.tenantId, tenantId)),
    db
      .select({
        id: fiscalYears.id,
        label: fiscalYears.label,
        startsOn: fiscalYears.startsOn,
        endsOn: fiscalYears.endsOn,
      })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.status, "open"))),
  ]);

  return {
    accountingAccountsByCode: new Map(accounts.map((row) => [row.code, row])),
    accountingJournalsByCode: new Map(journals.map((row) => [row.code, row])),
    accountingPartnersByCode: new Map(partnerRows.map((row) => [row.code, row])),
    accountingOpenFiscalYears: openYears,
  };
}

export async function applyAccountImport(
  tx: Transaction,
  input: ApplyAccountingImportInput,
): Promise<{ written: number }> {
  if (input.rows.length === 0) {
    throw new AccountingError("Aucun compte applicable dans cet import.");
  }

  const values = input.rows.map((row) => {
    const data = row.data as unknown as AccountImportData;
    const accountClass = accountClassOf(data.code);
    if (accountClass === null) {
      throw new AccountingError(
        `Ligne ${row.rowNumber} : compte ${data.code} invalide. Relancez l'analyse.`,
      );
    }
    return {
      tenantId: input.tenantId,
      code: data.code,
      label: data.label,
      accountClass,
      active: data.active,
    };
  });

  await tx
    .insert(ledgerAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [ledgerAccounts.tenantId, ledgerAccounts.code],
      set: {
        label: sql`excluded.label`,
        active: sql`excluded.active`,
        updatedAt: sql`now()`,
      },
    });

  await tx.execute(sql`
    update ${importRows} as r
    set entity_id = c.id
    from ${ledgerAccounts} as c
    where r.tenant_id = ${input.tenantId}
      and r.batch_id = ${input.batchId}
      and r.status <> 'error'
      and c.tenant_id = r.tenant_id
      and c.code = r.code
  `);

  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "accounting.account.import",
    entityType: "import_batch",
    entityId: input.batchId,
    details: {
      source: "import",
      written: values.length,
      codes: values.map((value) => value.code),
    },
  });

  return { written: values.length };
}

export async function applyJournalEntryImport(
  tx: Transaction,
  input: ApplyAccountingImportInput,
): Promise<ApplyJournalEntryImportResult> {
  if (input.rows.length === 0) {
    throw new AccountingError("Aucune écriture applicable dans cet import.");
  }

  const groups = new Map<string, StoredRow[]>();
  for (const row of input.rows) {
    const data = row.data as unknown as JournalEntryImportData;
    if (!data.groupKey) {
      throw new AccountingError(
        `Ligne ${row.rowNumber} : écriture incomplète. Relancez l'analyse.`,
      );
    }
    const group = groups.get(data.groupKey) ?? [];
    group.push(row);
    groups.set(data.groupKey, group);
  }

  const firstRows = [...groups.values()]
    .map((rows) => rows[0])
    .filter((row): row is StoredRow => Boolean(row))
    .sort((a, b) => a.rowNumber - b.rowNumber);
  const journalIds = [
    ...new Set(firstRows.map((row) => (row.data as unknown as JournalEntryImportData).journalId)),
  ];
  const accountIds = [
    ...new Set(input.rows.map((row) => (row.data as unknown as JournalEntryImportData).accountId)),
  ];
  const partnerIds = [
    ...new Set(
      input.rows
        .map((row) => (row.data as unknown as JournalEntryImportData).partnerId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const journalRows = await tx
    .select({
      id: accountingJournals.id,
      code: accountingJournals.code,
      active: accountingJournals.active,
    })
    .from(accountingJournals)
    .where(
      and(
        eq(accountingJournals.tenantId, input.tenantId),
        inArray(accountingJournals.id, journalIds),
      ),
    );
  const journalsById = new Map(journalRows.map((row) => [row.id, row]));

  const accountRows = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code, active: ledgerAccounts.active })
    .from(ledgerAccounts)
    .where(
      and(eq(ledgerAccounts.tenantId, input.tenantId), inArray(ledgerAccounts.id, accountIds)),
    );
  const accountsById = new Map(accountRows.map((row) => [row.id, row]));

  if (partnerIds.length > 0) {
    const partnerRows = await tx
      .select({ id: partners.id })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, partnerIds)));
    const known = new Set(partnerRows.map((row) => row.id));
    const missing = partnerIds.find((id) => !known.has(id));
    if (missing) {
      throw new AccountingError("Tiers introuvable : relancez l'analyse avant de confirmer.");
    }
  }

  const openYears = await tx
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.status, "open")));

  let written = 0;
  for (const rows of groups.values()) {
    const data = rows[0]?.data as unknown as JournalEntryImportData;
    const journal = journalsById.get(data.journalId);
    if (!journal) {
      throw new AccountingError("Journal introuvable : relancez l'analyse avant de confirmer.");
    }
    if (!journal.active) {
      throw new AccountingError(
        `Le journal ${journal.code} est inactif : relancez l'analyse après réactivation.`,
      );
    }
    const year = openYears.find(
      (candidate) => data.entryDate >= candidate.startsOn && data.entryDate <= candidate.endsOn,
    );
    if (!year) {
      throw new AccountingError(
        `Aucun exercice ouvert ne couvre le ${data.entryDate} : relancez l'analyse.`,
      );
    }

    const lines = rows.map((row) => {
      const line = row.data as unknown as JournalEntryImportData;
      const account = accountsById.get(line.accountId);
      if (!account) {
        throw new AccountingError("Compte introuvable : relancez l'analyse avant de confirmer.");
      }
      if (!account.active) {
        throw new AccountingError(`Le compte ${account.code} est inactif : relancez l'analyse.`);
      }
      return {
        accountId: line.accountId,
        partnerId: line.partnerId,
        label: line.lineLabel,
        debit: line.debit,
        credit: line.credit,
      };
    });

    const result = await insertJournalEntry(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      journalId: journal.id,
      journalCode: journal.code,
      fiscalYearId: year.id,
      fiscalYearLabel: year.label,
      entryDate: data.entryDate,
      reference: data.reference,
      label: data.label,
      lines,
      source: "import",
      batchId: input.batchId,
    });

    await tx
      .update(importRows)
      .set({ entityId: result.id })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          inArray(
            importRows.rowNumber,
            rows.map((row) => row.rowNumber),
          ),
        ),
      );

    written += rows.length;
  }

  return { entries: groups.size, written };
}
