import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  fiscalYears,
  journalEntries,
  journalEntryLines,
  ledgerAccounts,
  type JournalEntrySource,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedAccountingTenant, type AccountingTenant } from "@/test/accounting";
import {
  hasBalanceSheetActivity,
  hasResultActivity,
  nextIsoDay,
  planClosingEntry,
  planOpeningEntry,
  summarizeResult,
  type AccountBalance,
} from "./closing";
import {
  closeFiscalYear,
  createAccount,
  createFiscalYear,
  insertJournalEntry,
  setAccountActive,
  setJournalActive,
} from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

const YEAR_2026 = "2026-12-31";
const YEAR_2027 = "2027-01-01";

function bal(
  accountId: string,
  code: string,
  accountClass: number,
  debit: number,
  credit: number,
): AccountBalance {
  return { accountId, code, label: `Compte ${code}`, accountClass, debit, credit };
}

function sums(lines: readonly { debit: number; credit: number }[]): {
  readonly debit: number;
  readonly credit: number;
} {
  return lines.reduce(
    (total, line) => ({
      debit: total.debit + line.debit,
      credit: total.credit + line.credit,
    }),
    { debit: 0, credit: 0 },
  );
}

async function postEntry(
  ids: AccountingTenant,
  entryDate: string,
  lines: readonly { accountId: string; debit: number; credit: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await insertJournalEntry(tx, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      journalId: ids.saleJournalId,
      journalCode: "VE",
      fiscalYearId: ids.fiscalYear2026Id,
      fiscalYearLabel: "Exercice 2026",
      entryDate,
      reference: null,
      label: `Écriture ${entryDate}`,
      lines: lines.map((line) => ({ ...line, partnerId: null, label: null })),
      source: "manual",
      validated: true,
    });
  });
}

async function activateMisc(ids: AccountingTenant): Promise<void> {
  await setJournalActive(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    journalId: ids.inactiveJournalId,
    active: true,
  });
}

async function close(
  ids: AccountingTenant,
  fiscalYearId: string = ids.fiscalYear2026Id,
): Promise<void> {
  await closeFiscalYear(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    fiscalYearId,
  });
}

async function dropYear(ids: AccountingTenant, fiscalYearId: string): Promise<void> {
  await db.delete(fiscalYears).where(eq(fiscalYears.id, fiscalYearId));
}

interface SourceLine {
  readonly code: string;
  readonly label: string | null;
  readonly debit: number;
  readonly credit: number;
}

async function linesOfSource(
  tenantId: string,
  source: JournalEntrySource,
): Promise<readonly SourceLine[]> {
  const rows = await db
    .select({
      code: ledgerAccounts.code,
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
    .where(and(eq(journalEntryLines.tenantId, tenantId), eq(journalEntries.source, source)))
    .orderBy(asc(ledgerAccounts.code));
  return rows;
}

interface EntryMeta {
  readonly id: string;
  readonly number: string;
  readonly label: string;
  readonly entryDate: string;
  readonly status: string;
  readonly source: string;
  readonly sourceId: string | null;
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly validatedByUserId: string | null;
}

async function entryOfSource(
  tenantId: string,
  source: JournalEntrySource,
): Promise<EntryMeta | null> {
  const [entry] = await db
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      label: journalEntries.label,
      entryDate: journalEntries.entryDate,
      status: journalEntries.status,
      source: journalEntries.source,
      sourceId: journalEntries.sourceId,
      journalId: journalEntries.journalId,
      fiscalYearId: journalEntries.fiscalYearId,
      totalDebit: journalEntries.totalDebit,
      totalCredit: journalEntries.totalCredit,
      validatedByUserId: journalEntries.validatedByUserId,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.source, source)))
    .limit(1);
  return entry ?? null;
}

async function sourceCount(tenantId: string, source: JournalEntrySource): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.source, source)));
  return row?.value ?? 0;
}

async function yearStatus(tenantId: string, fiscalYearId: string): Promise<string | undefined> {
  const [year] = await db
    .select({ status: fiscalYears.status })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, fiscalYearId)));
  return year?.status;
}

async function closeAudit(
  tenantId: string,
  fiscalYearId: string,
): Promise<Record<string, unknown> | null> {
  const [event] = await db
    .select({ details: auditEvents.details })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "accounting.fiscal_year.close"),
        eq(auditEvents.entityId, fiscalYearId),
      ),
    )
    .limit(1);
  return event?.details ?? null;
}

/** Bénéfice de 100 000 F CFA : charges 100 000, produits 200 000 dont 50 000 hors activité. */
async function seedBenefitTenant(label: string): Promise<AccountingTenant> {
  const ids = await seedAccountingTenant(db, label);
  const outside = await createAccount(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: { code: "801000", label: "Produits hors activité ordinaire", active: true },
  });
  await postEntry(ids, "2026-03-10", [
    { accountId: ids.clientAccountId, debit: 150_000, credit: 0 },
    { accountId: ids.salesAccountId, debit: 0, credit: 150_000 },
  ]);
  await postEntry(ids, "2026-04-10", [
    { accountId: ids.purchaseAccountId, debit: 100_000, credit: 0 },
    { accountId: ids.bankAccountId, debit: 0, credit: 20_000 },
    { accountId: ids.supplierAccountId, debit: 0, credit: 80_000 },
  ]);
  await postEntry(ids, "2026-05-10", [
    { accountId: ids.bankAccountId, debit: 50_000, credit: 0 },
    { accountId: outside.id, debit: 0, credit: 50_000 },
  ]);
  return ids;
}

describe("RPT-005 — écriture de clôture", () => {
  it("solde les classes 6, 7 et 8 puis porte le bénéfice en 131", () => {
    const balances: readonly AccountBalance[] = [
      bal("c1", "411000", 4, 150_000, 0),
      bal("c2", "401000", 4, 0, 80_000),
      bal("c3", "521000", 5, 50_000, 20_000),
      bal("c4", "601000", 6, 100_000, 0),
      bal("c5", "701000", 7, 0, 150_000),
      bal("c6", "801000", 8, 0, 50_000),
    ];

    expect(summarizeResult(balances)).toEqual({
      charges: 100_000,
      produits: 200_000,
      result: 100_000,
    });
    expect(hasResultActivity(balances)).toBe(true);
    expect(hasBalanceSheetActivity(balances)).toBe(true);
    expect(nextIsoDay(YEAR_2026)).toBe(YEAR_2027);

    const lines = planClosingEntry(balances, { id: "r", code: "131000" });
    expect(lines).toEqual([
      {
        accountId: "c4",
        partnerId: null,
        label: "Solde 601000",
        debit: 0,
        credit: 100_000,
      },
      { accountId: "c5", partnerId: null, label: "Solde 701000", debit: 150_000, credit: 0 },
      { accountId: "c6", partnerId: null, label: "Solde 801000", debit: 50_000, credit: 0 },
      {
        accountId: "r",
        partnerId: null,
        label: "Résultat net : bénéfice",
        debit: 0,
        credit: 100_000,
      },
    ]);
    expect(sums(lines)).toEqual({ debit: 200_000, credit: 200_000 });
  });

  it("porte la perte en 139 et refuse un résultat non nul sans compte de résultat", () => {
    const balances: readonly AccountBalance[] = [
      bal("c1", "401000", 4, 0, 70_000),
      bal("c2", "601000", 6, 120_000, 0),
      bal("c3", "701000", 7, 0, 50_000),
    ];
    expect(summarizeResult(balances)).toEqual({
      charges: 120_000,
      produits: 50_000,
      result: -70_000,
    });
    expect(planClosingEntry(balances, { id: "p", code: "139000" })).toEqual([
      { accountId: "c2", partnerId: null, label: "Solde 601000", debit: 0, credit: 120_000 },
      { accountId: "c3", partnerId: null, label: "Solde 701000", debit: 50_000, credit: 0 },
      { accountId: "p", partnerId: null, label: "Résultat net : perte", debit: 70_000, credit: 0 },
    ]);

    expect(() => planClosingEntry(balances, null)).toThrow(/131 ou 139/);
  });

  it("n'exige aucun compte 131 ou 139 sur un résultat nul", () => {
    const balances: readonly AccountBalance[] = [
      bal("c1", "411000", 4, 100_000, 100_000),
      bal("c2", "601000", 6, 100_000, 0),
      bal("c3", "701000", 7, 0, 100_000),
    ];
    expect(summarizeResult(balances).result).toBe(0);
    expect(hasBalanceSheetActivity(balances)).toBe(false);
    expect(planClosingEntry(balances, null)).toEqual([
      { accountId: "c2", partnerId: null, label: "Solde 601000", debit: 0, credit: 100_000 },
      { accountId: "c3", partnerId: null, label: "Solde 701000", debit: 100_000, credit: 0 },
    ]);
  });

  it("reprend les soldes de bilan au sens du solde, hors classes 6 à 8", () => {
    const balances: readonly AccountBalance[] = [
      bal("c1", "131000", 1, 0, 100_000),
      bal("c2", "401000", 4, 0, 80_000),
      bal("c3", "411000", 4, 150_000, 0),
      bal("c4", "521000", 5, 50_000, 20_000),
      bal("c5", "601000", 6, 100_000, 100_000),
      bal("c6", "701000", 7, 150_000, 150_000),
    ];
    expect(planOpeningEntry(balances)).toEqual([
      { accountId: "c1", partnerId: null, label: "À-nouveaux 131000", debit: 0, credit: 100_000 },
      { accountId: "c2", partnerId: null, label: "À-nouveaux 401000", debit: 0, credit: 80_000 },
      {
        accountId: "c3",
        partnerId: null,
        label: "À-nouveaux 411000",
        debit: 150_000,
        credit: 0,
      },
      { accountId: "c4", partnerId: null, label: "À-nouveaux 521000", debit: 30_000, credit: 0 },
    ]);
  });

  it("refuse la clôture sans journal divers actif, puis sans compte 131", async () => {
    const ids = await seedBenefitTenant("rpt-005-refus");

    await expect(close(ids)).rejects.toThrow(/journal de type divers actif/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("open");

    await activateMisc(ids);
    await expect(close(ids)).rejects.toThrow(/créez et activez le compte 131/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);
    expect(await sourceCount(ids.tenantId, "fiscal_year_open")).toBe(0);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("open");

    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });
    await close(ids);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("closed");
  });

  it("clôture par une écriture validée d'emblée, unique et audité", async () => {
    const ids = await seedBenefitTenant("rpt-005-benefice");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });

    await close(ids);

    const entry = await entryOfSource(ids.tenantId, "fiscal_year_close");
    expect(entry).toMatchObject({
      label: "Clôture Exercice 2026",
      entryDate: YEAR_2026,
      status: "validated",
      source: "fiscal_year_close",
      sourceId: ids.fiscalYear2026Id,
      journalId: ids.inactiveJournalId,
      fiscalYearId: ids.fiscalYear2026Id,
      totalDebit: 200_000,
      totalCredit: 200_000,
      validatedByUserId: ids.userId,
    });
    expect(entry?.number).toMatch(/^OD-2026-\d{4}$/);

    const codes = (await linesOfSource(ids.tenantId, "fiscal_year_close")).map((line) => line.code);
    expect(codes).toEqual(["131000", "601000", "701000", "801000"]);

    await expect(close(ids)).rejects.toThrow(/déjà clôturé/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(1);

    const details = await closeAudit(ids.tenantId, ids.fiscalYear2026Id);
    expect(details).toMatchObject({
      label: "Exercice 2026",
      charges: 100_000,
      produits: 200_000,
      result: 100_000,
      closingNumber: entry?.number,
    });

    const created = await db
      .select({ action: auditEvents.action, entityId: auditEvents.entityId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.entry.create"),
        ),
      );
    expect(created.filter((row) => row.entityId === entry?.id)).toHaveLength(1);
  });

  it("solde aussi les comptes désactivés depuis la saisie", async () => {
    const ids = await seedBenefitTenant("rpt-005-inactif");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });
    await setAccountActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      accountId: ids.purchaseAccountId,
      active: false,
    });

    await close(ids);

    const lines = await linesOfSource(ids.tenantId, "fiscal_year_close");
    expect(lines.find((line) => line.code === "601000")).toMatchObject({
      debit: 0,
      credit: 100_000,
    });
  });

  it("produit une perte débitée en 139, jamais un compte 131", async () => {
    const ids = await seedAccountingTenant(db, "rpt-005-perte");
    await postEntry(ids, "2026-04-10", [
      { accountId: ids.purchaseAccountId, debit: 120_000, credit: 0 },
      { accountId: ids.supplierAccountId, debit: 0, credit: 70_000 },
      { accountId: ids.salesAccountId, debit: 0, credit: 50_000 },
    ]);
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });

    await expect(close(ids)).rejects.toThrow(/créez et activez le compte 139/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);

    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "139000", label: "Résultat net : perte", active: true },
    });
    await close(ids);

    expect(await linesOfSource(ids.tenantId, "fiscal_year_close")).toEqual([
      { code: "139000", label: "Résultat net : perte", debit: 70_000, credit: 0 },
      { code: "601000", label: "Solde 601000", debit: 0, credit: 120_000 },
      { code: "701000", label: "Solde 701000", debit: 50_000, credit: 0 },
    ]);

    const details = await closeAudit(ids.tenantId, ids.fiscalYear2026Id);
    expect(details).toMatchObject({ charges: 120_000, produits: 50_000, result: -70_000 });
  });

  it("ne produit aucune écriture pour un exercice sans mouvement", async () => {
    const ids = await seedAccountingTenant(db, "rpt-005-vide");

    await close(ids);

    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);
    expect(await sourceCount(ids.tenantId, "fiscal_year_open")).toBe(0);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("closed");
    expect(await closeAudit(ids.tenantId, ids.fiscalYear2026Id)).toMatchObject({
      charges: 0,
      produits: 0,
      result: 0,
    });
    expect(await closeAudit(ids.tenantId, ids.fiscalYear2026Id)).not.toHaveProperty(
      "closingNumber",
    );
  });

  it("cloisonne la clôture par espace et refuse un exercice d'un autre espace", async () => {
    const ids = await seedBenefitTenant("rpt-005-cloison");
    const other = await seedAccountingTenant(db, "rpt-005-cloison-voisin");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });

    await expect(
      closeFiscalYear(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fiscalYearId: other.fiscalYear2026Id,
      }),
    ).rejects.toThrow(/Exercice introuvable dans cet espace/);

    await close(ids);

    expect(await yearStatus(other.tenantId, other.fiscalYear2026Id)).toBe("open");
    expect(await sourceCount(other.tenantId, "fiscal_year_close")).toBe(0);
    expect(await sourceCount(other.tenantId, "fiscal_year_open")).toBe(0);
  });
});

describe("RPT-006 — écriture d'à-nouveaux", () => {
  it("refuse la clôture sans exercice suivant, sans laisser la moindre écriture", async () => {
    const ids = await seedBenefitTenant("rpt-006-absent");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });
    await dropYear(ids, ids.fiscalYear2027Id);

    await expect(close(ids)).rejects.toThrow(/aucun exercice ouvert ne commence le 2027-01-01/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);
    expect(await sourceCount(ids.tenantId, "fiscal_year_open")).toBe(0);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("open");
  });

  it("refuse un exercice suivant qui ne commence pas le lendemain de la clôture", async () => {
    const ids = await seedBenefitTenant("rpt-006-decale");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });
    await dropYear(ids, ids.fiscalYear2027Id);
    await createFiscalYear(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { label: "Exercice 2027 décalé", startsOn: "2027-01-02", endsOn: "2027-12-31" },
    });

    await expect(close(ids)).rejects.toThrow(/ne commence le 2027-01-01/);
    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(0);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("open");
  });

  it("reprend les soldes de bilan et le 131 au premier jour de l'exercice suivant", async () => {
    const ids = await seedBenefitTenant("rpt-006-soldes");
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "131000", label: "Résultat net : bénéfice", active: true },
    });

    await close(ids);

    const entry = await entryOfSource(ids.tenantId, "fiscal_year_open");
    expect(entry).toMatchObject({
      label: "À-nouveaux Exercice 2027",
      entryDate: YEAR_2027,
      status: "validated",
      source: "fiscal_year_open",
      sourceId: ids.fiscalYear2026Id,
      journalId: ids.inactiveJournalId,
      fiscalYearId: ids.fiscalYear2027Id,
      totalDebit: 180_000,
      totalCredit: 180_000,
    });
    expect(entry?.number).toMatch(/^OD-2027-\d{4}$/);

    const lines = await linesOfSource(ids.tenantId, "fiscal_year_open");
    expect(lines.map((line) => line.code)).toEqual(["131000", "401000", "411000", "521000"]);
    expect(
      lines.map((line) => ({ code: line.code, debit: line.debit, credit: line.credit })),
    ).toEqual([
      { code: "131000", debit: 0, credit: 100_000 },
      { code: "401000", debit: 0, credit: 80_000 },
      { code: "411000", debit: 150_000, credit: 0 },
      { code: "521000", debit: 30_000, credit: 0 },
    ]);

    expect(await sourceCount(ids.tenantId, "fiscal_year_open")).toBe(1);
    const details = await closeAudit(ids.tenantId, ids.fiscalYear2026Id);
    expect(details).toMatchObject({ openingNumber: entry?.number });
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2027Id)).toBe("open");
  });

  it("ne produit ni à-nouveaux ni exigence d'exercice suivant sans solde de bilan", async () => {
    const ids = await seedAccountingTenant(db, "rpt-006-solde-nul");
    await postEntry(ids, "2026-04-10", [
      { accountId: ids.purchaseAccountId, debit: 100_000, credit: 0 },
      { accountId: ids.clientAccountId, debit: 0, credit: 100_000 },
    ]);
    await postEntry(ids, "2026-06-10", [
      { accountId: ids.clientAccountId, debit: 100_000, credit: 0 },
      { accountId: ids.salesAccountId, debit: 0, credit: 100_000 },
    ]);
    await activateMisc(ids);
    await dropYear(ids, ids.fiscalYear2027Id);

    await close(ids);

    expect(await sourceCount(ids.tenantId, "fiscal_year_close")).toBe(1);
    expect(await sourceCount(ids.tenantId, "fiscal_year_open")).toBe(0);
    expect(await linesOfSource(ids.tenantId, "fiscal_year_close")).toEqual([
      { code: "601000", label: "Solde 601000", debit: 0, credit: 100_000 },
      { code: "701000", label: "Solde 701000", debit: 100_000, credit: 0 },
    ]);
    expect(await yearStatus(ids.tenantId, ids.fiscalYear2026Id)).toBe("closed");
  });

  it("clôture une perte avec ses à-nouveaux au débit du 139", async () => {
    const ids = await seedAccountingTenant(db, "rpt-006-perte");
    await postEntry(ids, "2026-04-10", [
      { accountId: ids.purchaseAccountId, debit: 120_000, credit: 0 },
      { accountId: ids.supplierAccountId, debit: 0, credit: 70_000 },
      { accountId: ids.salesAccountId, debit: 0, credit: 50_000 },
    ]);
    await activateMisc(ids);
    await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "139000", label: "Résultat net : perte", active: true },
    });

    await close(ids);

    expect(await linesOfSource(ids.tenantId, "fiscal_year_open")).toEqual([
      { code: "139000", label: "À-nouveaux 139000", debit: 70_000, credit: 0 },
      { code: "401000", label: "À-nouveaux 401000", debit: 0, credit: 70_000 },
    ]);
  });
});
