import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, fiscalYears, journalEntries, journalEntryLines } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedAccountingTenant, type AccountingTenant } from "@/test/accounting";
import { AccountingError } from "./errors";
import { accountClassOf } from "./validation";
import {
  closeFiscalYear,
  createAccount,
  createFiscalYear,
  createJournal,
  createJournalEntry,
  deleteJournalEntry,
  getBalanceReport,
  getJournalEntry,
  getLedgerReport,
  listAccounts,
  listJournalEntries,
  listJournals,
  setAccountActive,
  setJournalActive,
  validateJournalEntry,
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

interface EntryOptions {
  journalId?: string;
  date?: string;
  reference?: string;
  label?: string;
  lines?: readonly {
    accountId: string;
    partnerId?: string;
    label?: string;
    debit: string;
    credit: string;
  }[];
}

function balancedLines(
  ids: AccountingTenant,
  amount = "100000",
  extra: { partnerId?: string } = {},
): NonNullable<EntryOptions["lines"]> {
  return [
    {
      accountId: ids.clientAccountId,
      partnerId: extra.partnerId ?? ids.partnerId,
      label: "Facture client",
      debit: amount,
      credit: "",
    },
    {
      accountId: ids.salesAccountId,
      partnerId: "",
      label: "Vente",
      debit: "",
      credit: amount,
    },
  ];
}

async function createEntry(
  ids: AccountingTenant,
  options: EntryOptions = {},
): Promise<{ id: string; number: string }> {
  return createJournalEntry(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: {
      journalId: options.journalId ?? ids.saleJournalId,
      entryDate: options.date ?? "2026-06-30",
      reference: options.reference ?? "",
      label: options.label ?? "Facture de vente",
      lines: options.lines ?? balancedLines(ids),
    },
  });
}

async function entryCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId));
  return row?.value ?? 0;
}

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.entityType, "journal_entry")))
    .orderBy(asc(auditEvents.createdAt));
  return rows.map((row) => row.action);
}

async function closeYearFully(ids: AccountingTenant): Promise<void> {
  await closeFiscalYear(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    fiscalYearId: ids.fiscalYear2026Id,
  });
}

describe("ACC-001 — exercice comptable borné, clôturable", () => {
  it("refuse un chevauchement, une période inversée ou trop longue", async () => {
    const ids = await seedAccountingTenant(db, "acc-001-bornes");

    await expect(
      createFiscalYear(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { label: "Chevauchement", startsOn: "2026-07-01", endsOn: "2027-06-30" },
      }),
    ).rejects.toThrow(/chevauche/);

    await expect(
      createFiscalYear(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { label: "Période inversée", startsOn: "2028-12-31", endsOn: "2028-01-01" },
      }),
    ).rejects.toThrow(/précéder/);

    await expect(
      createFiscalYear(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { label: "Trop long", startsOn: "2028-01-01", endsOn: "2029-01-02" },
      }),
    ).rejects.toThrow(/366 jours maximum/);

    const created = await createFiscalYear(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { label: "Exercice 2028", startsOn: "2028-01-01", endsOn: "2028-12-31" },
    });
    expect(created.id).toBeTruthy();

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.fiscal_year.create"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({ label: "Exercice 2028" });
  });

  it("refuse une date hors exercice ouvert et bloque après clôture", async () => {
    const ids = await seedAccountingTenant(db, "acc-001-cloture");

    await expect(createEntry(ids, { date: "2025-06-15" })).rejects.toThrow(/Aucun exercice ouvert/);
    await expect(createEntry(ids, { date: "2028-01-02" })).rejects.toThrow(/Aucun exercice ouvert/);

    const draft = await createEntry(ids, { date: "2026-06-30" });
    await expect(closeYearFully(ids)).rejects.toThrow(/Clôture refusée/);

    await deleteJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: draft.id,
    });
    await closeYearFully(ids);

    const [year] = await db
      .select({
        status: fiscalYears.status,
        closedAt: fiscalYears.closedAt,
        closedBy: fiscalYears.closedByUserId,
      })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, ids.fiscalYear2026Id));
    expect(year?.status).toBe("closed");
    expect(year?.closedBy).toBe(ids.userId);
    expect(year?.closedAt).toBeInstanceOf(Date);

    const audit = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.fiscal_year.close"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ label: "Exercice 2026" });

    await expect(closeYearFully(ids)).rejects.toThrow(/déjà clôturé/);
    await expect(createEntry(ids, { date: "2026-07-01" })).rejects.toThrow(/Aucun exercice ouvert/);
  });
});

describe("ACC-002 — plan comptable SYSCOHADA", () => {
  it("valide le format et la classe, refuse un doublon", async () => {
    const ids = await seedAccountingTenant(db, "acc-002-format");

    expect(accountClassOf("411000")).toBe(4);
    expect(accountClassOf("701000")).toBe(7);
    expect(accountClassOf("9")).toBeNull();
    expect(accountClassOf("901000")).toBeNull();
    expect(accountClassOf("1")).toBeNull();

    for (const code of ["9", "901000", "1"]) {
      await expect(
        createAccount(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          raw: { code, label: "Compte invalide" },
        }),
      ).rejects.toThrow(/2 à 10 chiffres/);
    }

    await expect(
      createAccount(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "411000", label: "Clients doublon" },
      }),
    ).rejects.toThrow(/existe déjà/);

    await expect(
      createAccount(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "421000", label: "   " },
      }),
    ).rejects.toThrow(/Libellé du compte : obligatoire/);

    const accounts = await listAccounts(db, { tenantId: ids.tenantId });
    const clients = accounts.find((account) => account.code === "411000");
    expect(clients).toMatchObject({ accountClass: 4, label: "Clients", active: true });
  });

  it("désactive sans effacer et cloisonne par espace", async () => {
    const ids = await seedAccountingTenant(db, "acc-002-statut");
    const other = await seedAccountingTenant(db, "acc-002-autre");

    await setAccountActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      accountId: ids.clientAccountId,
      active: false,
    });

    const active = await listAccounts(db, { tenantId: ids.tenantId, activeOnly: true });
    expect(active.some((account) => account.code === "411000")).toBe(false);
    const all = await listAccounts(db, { tenantId: ids.tenantId });
    expect(all.find((account) => account.code === "411000")?.active).toBe(false);

    await expect(createEntry(ids)).rejects.toThrow(/411000 est inactif/);

    const otherClients = await listAccounts(db, { tenantId: other.tenantId });
    expect(otherClients.find((account) => account.code === "411000")?.active).toBe(true);

    const here = await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "421000", label: "Personnel — avances" },
    });
    const elsewhere = await createAccount(db, {
      tenantId: other.tenantId,
      actorUserId: other.userId,
      raw: { code: "421000", label: "Personnel — avances" },
    });
    expect(elsewhere.id).not.toBe(here.id);

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityType, "ledger_account")),
      );
    expect(actions.map((row) => row.action).sort()).toEqual([
      "accounting.account.create",
      "accounting.account.status",
    ]);
  });
});

describe("ACC-003 — journaux", () => {
  it("normalise le code, refuse un doublon et un code invalide", async () => {
    const ids = await seedAccountingTenant(db, "acc-003-format");

    const created = await createJournal(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "ca", label: "Journal de caisse", type: "cash" },
    });
    expect(created.id).toBeTruthy();
    const journals = await listJournals(db, { tenantId: ids.tenantId });
    expect(journals.find((journal) => journal.code === "CA")?.label).toBe("Journal de caisse");

    await expect(
      createJournal(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "VE", label: "Doublon", type: "sale" },
      }),
    ).rejects.toThrow(/existe déjà/);

    for (const code of ["V", "V-E!"]) {
      await expect(
        createJournal(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          raw: { code, label: "Code invalide", type: "sale" },
        }),
      ).rejects.toThrow(/2 à 6 caractères/);
    }

    await expect(
      createJournal(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "XX", label: "Type invalide", type: "inconnu" },
      }),
    ).rejects.toThrow(/Type du journal : valeur inconnue/);
  });

  it("désactive un journal sans effacer ses écritures", async () => {
    const ids = await seedAccountingTenant(db, "acc-003-statut");
    const entry = await createEntry(ids, { journalId: ids.bankJournalId });

    await setJournalActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      journalId: ids.bankJournalId,
      active: false,
    });

    const active = await listJournals(db, { tenantId: ids.tenantId, activeOnly: true });
    expect(active.some((journal) => journal.code === "BQ")).toBe(false);
    await expect(createEntry(ids, { journalId: ids.bankJournalId })).rejects.toThrow(/inactif/);

    const detail = await getJournalEntry(db, { tenantId: ids.tenantId, entryId: entry.id });
    expect(detail?.journalCode).toBe("BQ");
    expect(detail?.status).toBe("draft");

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.entityType, "accounting_journal"),
        ),
      );
    expect(actions.map((row) => row.action)).toEqual(["accounting.journal.status"]);
  });
});

describe("ACC-004 — écriture équilibrée en brouillon", () => {
  it("crée un brouillon équilibré avec ses lignes", async () => {
    const ids = await seedAccountingTenant(db, "acc-004-equilibre");

    const created = await createEntry(ids);
    expect(created.number).toBe("VE-2026-0001");

    const detail = await getJournalEntry(db, { tenantId: ids.tenantId, entryId: created.id });
    expect(detail).toMatchObject({
      status: "draft",
      totalDebit: 100_000,
      totalCredit: 100_000,
      journalCode: "VE",
      fiscalYearLabel: "Exercice 2026",
    });
    expect(detail?.lines).toHaveLength(2);
    expect(detail?.lines[0]).toMatchObject({
      lineNumber: 1,
      accountCode: "411000",
      partnerName: "Sahel Distribution",
      debit: 100_000,
      credit: 0,
    });
    expect(detail?.lines[1]).toMatchObject({
      lineNumber: 2,
      accountCode: "701000",
      debit: 0,
      credit: 100_000,
    });

    expect(await auditActions(ids.tenantId)).toContain("accounting.entry.create");
  });

  it("refuse les écritures invalides sans rien écrire", async () => {
    const ids = await seedAccountingTenant(db, "acc-004-refus");
    const other = await seedAccountingTenant(db, "acc-004-voisin");

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.clientAccountId, debit: "100000", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "90000" },
        ],
      }),
    ).rejects.toThrow(/déséquilibrée/);

    await expect(
      createEntry(ids, {
        lines: [{ accountId: ids.clientAccountId, debit: "100000", credit: "" }],
      }),
    ).rejects.toThrow(/au moins deux lignes/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.clientAccountId, debit: "100000", credit: "100000" },
          { accountId: ids.salesAccountId, debit: "", credit: "100000" },
        ],
      }),
    ).rejects.toThrow(/un seul montant par ligne/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.clientAccountId, debit: "", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "" },
        ],
      }),
    ).rejects.toThrow(/strictement positif/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.clientAccountId, debit: "100,5", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "100" },
        ],
      }),
    ).rejects.toThrow(/montant XOF entier/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.clientAccountId, debit: "-100", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "100" },
        ],
      }),
    ).rejects.toThrow(/montant XOF entier/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: ids.inactiveAccountId, debit: "100000", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "100000" },
        ],
      }),
    ).rejects.toThrow(/571000 est inactif/);

    await expect(createEntry(ids, { journalId: ids.inactiveJournalId })).rejects.toThrow(
      /OD est inactif/,
    );

    await expect(
      createEntry(ids, {
        lines: [
          {
            accountId: ids.clientAccountId,
            partnerId: other.partnerId,
            debit: "100000",
            credit: "",
          },
          { accountId: ids.salesAccountId, debit: "", credit: "100000" },
        ],
      }),
    ).rejects.toThrow(/Tiers introuvable/);

    await expect(createEntry(ids, { reference: "P".repeat(61) })).rejects.toThrow(
      /60 caractères maximum/,
    );

    expect(await entryCount(ids.tenantId)).toBe(0);
  });
});

describe("ACC-005 — numérotation séquentielle par journal et année", () => {
  it("numérote par journal et par année, sans réutiliser un numéro supprimé", async () => {
    const ids = await seedAccountingTenant(db, "acc-005-sequence");
    const other = await seedAccountingTenant(db, "acc-005-voisin");

    const first = await createEntry(ids);
    const second = await createEntry(ids);
    expect([first.number, second.number]).toEqual(["VE-2026-0001", "VE-2026-0002"]);

    const bank = await createEntry(ids, { journalId: ids.bankJournalId });
    expect(bank.number).toBe("BQ-2026-0001");

    const nextYear = await createEntry(ids, { date: "2027-03-01" });
    expect(nextYear.number).toBe("VE-2027-0001");

    await deleteJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: second.id,
    });

    const third = await createEntry(ids);
    expect(third.number).toBe("VE-2026-0003");

    const otherEntry = await createEntry(other);
    expect(otherEntry.number).toBe("VE-2026-0001");
  });
});

describe("ACC-006 — validation unique et suppression du brouillon", () => {
  it("valide une seule fois et rend l'écriture immuable", async () => {
    const ids = await seedAccountingTenant(db, "acc-006-validation");
    const created = await createEntry(ids);

    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: created.id,
    });

    const detail = await getJournalEntry(db, { tenantId: ids.tenantId, entryId: created.id });
    expect(detail?.status).toBe("validated");

    const [row] = await db
      .select({
        validatedBy: journalEntries.validatedByUserId,
        validatedAt: journalEntries.validatedAt,
      })
      .from(journalEntries)
      .where(eq(journalEntries.id, created.id));
    expect(row?.validatedBy).toBe(ids.userId);
    expect(row?.validatedAt).toBeInstanceOf(Date);

    await expect(
      validateJournalEntry(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        entryId: created.id,
      }),
    ).rejects.toThrow(/déjà validée/);

    await expect(
      deleteJournalEntry(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        entryId: created.id,
      }),
    ).rejects.toThrow(/ne peut plus être supprimée/);

    expect(await auditActions(ids.tenantId)).toEqual([
      "accounting.entry.create",
      "accounting.entry.validate",
    ]);
  });

  it("supprime un brouillon avec ses lignes et l'audite", async () => {
    const ids = await seedAccountingTenant(db, "acc-006-suppression");
    const created = await createEntry(ids);

    await deleteJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: created.id,
    });

    expect(await getJournalEntry(db, { tenantId: ids.tenantId, entryId: created.id })).toBeNull();
    const [lines] = await db
      .select({ value: count() })
      .from(journalEntryLines)
      .where(eq(journalEntryLines.tenantId, ids.tenantId));
    expect(lines?.value).toBe(0);

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.entry.delete"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({ number: "VE-2026-0001" });
  });
});

describe("ACC-007 — balance générale des écritures validées", () => {
  it("calcule les soldes des seules écritures validées de l'exercice", async () => {
    const ids = await seedAccountingTenant(db, "acc-007-balance");
    const other = await seedAccountingTenant(db, "acc-007-voisin");

    const invoice = await createEntry(ids);
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: invoice.id,
    });
    const payment = await createEntry(ids, {
      journalId: ids.bankJournalId,
      label: "Encaissement",
      lines: [
        { accountId: ids.bankAccountId, debit: "40000", credit: "" },
        { accountId: ids.clientAccountId, debit: "", credit: "40000" },
      ],
    });
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: payment.id,
    });

    await createEntry(ids);
    await createEntry(other);
    const nextYear = await createEntry(ids, { date: "2027-02-01" });
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: nextYear.id,
    });

    const report = await getBalanceReport(db, {
      tenantId: ids.tenantId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    expect(report).not.toBeNull();
    expect(report?.totalDebit).toBe(140_000);
    expect(report?.totalCredit).toBe(140_000);

    const byCode = new Map(report?.rows.map((row) => [row.code, row]) ?? []);
    expect(byCode.get("411000")).toMatchObject({ debit: 100_000, credit: 40_000, balance: 60_000 });
    expect(byCode.get("701000")).toMatchObject({ debit: 0, credit: 100_000, balance: -100_000 });
    expect(byCode.get("521000")).toMatchObject({ debit: 40_000, credit: 0, balance: 40_000 });
    expect(byCode.has("601000")).toBe(false);

    const otherReport = await getBalanceReport(db, {
      tenantId: other.tenantId,
      fiscalYearId: other.fiscalYear2026Id,
    });
    expect(otherReport?.rows).toHaveLength(0);
    expect(
      await getBalanceReport(db, {
        tenantId: ids.tenantId,
        fiscalYearId: other.fiscalYear2026Id,
      }),
    ).toBeNull();
    expect(
      await getBalanceReport(db, { tenantId: ids.tenantId, fiscalYearId: ids.closedFiscalYearId }),
    ).toMatchObject({ totalDebit: 0, totalCredit: 0, rows: [] });
  });
});

describe("ACC-008 — grand livre d'un compte et d'un exercice", () => {
  it("ordonne par date puis numéro et suit le solde progressif", async () => {
    const ids = await seedAccountingTenant(db, "acc-008-grand-livre");
    const other = await seedAccountingTenant(db, "acc-008-voisin");

    const first = await createEntry(ids, { date: "2026-06-10", label: "Facture 014" });
    const second = await createEntry(ids, {
      date: "2026-06-20",
      journalId: ids.bankJournalId,
      label: "Encaissement partiel",
      lines: [
        { accountId: ids.bankAccountId, debit: "40000", credit: "" },
        { accountId: ids.clientAccountId, debit: "", credit: "40000" },
      ],
    });
    for (const entry of [first, second]) {
      await validateJournalEntry(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        entryId: entry.id,
      });
    }
    const draft = await createEntry(ids, { date: "2026-06-25", label: "Brouillon exclu" });
    expect(draft.number).toBe("VE-2026-0002");

    const ledger = await getLedgerReport(db, {
      tenantId: ids.tenantId,
      accountId: ids.clientAccountId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    expect(ledger).not.toBeNull();
    expect(ledger?.lines.map((line) => line.entryNumber)).toEqual(["VE-2026-0001", "BQ-2026-0001"]);
    expect(ledger?.lines.map((line) => line.runningBalance)).toEqual([100_000, 60_000]);
    expect(ledger?.lines[1]).toMatchObject({
      entryLabel: "Encaissement partiel",
      debit: 0,
      credit: 40_000,
    });
    expect(ledger).toMatchObject({
      totalDebit: 100_000,
      totalCredit: 40_000,
      balance: 60_000,
      truncated: false,
    });

    const balance = await getBalanceReport(db, {
      tenantId: ids.tenantId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    const clientRow = balance?.rows.find((row) => row.accountId === ids.clientAccountId);
    expect(clientRow?.balance).toBe(ledger?.balance);

    const untouched = await getLedgerReport(db, {
      tenantId: ids.tenantId,
      accountId: ids.supplierAccountId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    expect(untouched?.lines).toHaveLength(0);
    expect(untouched?.balance).toBe(0);

    expect(
      await getLedgerReport(db, {
        tenantId: other.tenantId,
        accountId: ids.clientAccountId,
        fiscalYearId: ids.fiscalYear2026Id,
      }),
    ).toBeNull();
    expect(
      await getLedgerReport(db, {
        tenantId: ids.tenantId,
        accountId: ids.clientAccountId,
        fiscalYearId: other.fiscalYear2026Id,
      }),
    ).toBeNull();
  });

  it("filtre les écritures par statut dans la liste", async () => {
    const ids = await seedAccountingTenant(db, "acc-008-filtre");
    const validated = await createEntry(ids);
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: validated.id,
    });
    await createEntry(ids);

    const drafts = await listJournalEntries(db, { tenantId: ids.tenantId, status: "draft" });
    const confirmed = await listJournalEntries(db, {
      tenantId: ids.tenantId,
      status: "validated",
    });
    expect(drafts.map((entry) => entry.number)).toEqual(["VE-2026-0002"]);
    expect(confirmed.map((entry) => entry.number)).toEqual(["VE-2026-0001"]);
  });
});

describe("cloisonnement du module", () => {
  it("refuse les références d'un autre espace", async () => {
    const ids = await seedAccountingTenant(db, "acc-iso");
    const other = await seedAccountingTenant(db, "acc-iso-voisin");

    await expect(
      createEntry(ids, {
        journalId: other.saleJournalId,
      }),
    ).rejects.toThrow(/Journal introuvable/);

    await expect(
      createEntry(ids, {
        lines: [
          { accountId: other.clientAccountId, debit: "100000", credit: "" },
          { accountId: ids.salesAccountId, debit: "", credit: "100000" },
        ],
      }),
    ).rejects.toThrow(/Compte introuvable/);

    await expect(
      validateJournalEntry(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        entryId: (await createEntry(ids)).id,
      }),
    ).rejects.toBeInstanceOf(AccountingError);
  });
});
