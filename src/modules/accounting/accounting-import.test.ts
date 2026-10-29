import { createHash } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, importRows, journalEntries, ledgerAccounts } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedAccountingTenant, type AccountingTenant } from "@/test/accounting";
import {
  ACCOUNT_HEADERS,
  HEADERS_BY_KIND,
  JOURNAL_ENTRY_HEADERS,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
} from "@/modules/catalog/constants";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import { buildTemplate } from "@/modules/catalog/xlsx";
import type { RawImportRow } from "@/modules/catalog/validation";

type LoadInput = Parameters<Workbook["xlsx"]["load"]>[0];

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

function hashOf(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

function accountRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      code: "411000",
      libelle: "Clients",
      actif: "Oui",
      ...overrides,
    },
  };
}

async function analyzeAccounts(
  ids: AccountingTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("comptes"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "accounts",
    fileName: "comptes.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

interface EntryLineValues {
  journal: string;
  date: string;
  piece: string;
  libelle: string;
  libelle_ligne: string;
  compte: string;
  tiers: string;
  debit: string;
  credit: string;
}

function entryRow(rowNumber: number, overrides: Partial<EntryLineValues> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      journal: "VE",
      date: "2026-06-15",
      piece: "FAC-2026-014",
      libelle: "Facture de vente 014",
      libelle_ligne: "Facture client",
      compte: "411000",
      tiers: "CLI001",
      debit: "150000",
      credit: "",
      ...overrides,
    },
  };
}

async function analyzeEntries(
  ids: AccountingTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("ecritures"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "journal_entries",
    fileName: "ecritures.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function entryCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId));
  return row?.value ?? 0;
}

describe("ACC-010 — import XLSX du plan comptable", () => {
  it("produit un modèle à trois colonnes avec la liste Oui/Non", async () => {
    expect([...ACCOUNT_HEADERS]).toEqual(["code", "libelle", "actif"]);
    expect([...HEADERS_BY_KIND.accounts]).toEqual([...ACCOUNT_HEADERS]);

    const workbook = await loadWorkbook(await buildTemplate("accounts"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();
    const headers = ACCOUNT_HEADERS.map((_, index) => data?.getRow(1).getCell(index + 1).value);
    expect(headers).toEqual([...ACCOUNT_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getCell("C2").dataValidation.formulae).toEqual(['"Oui,Non"']);
  });

  it("bloque l'application quand une ligne est en erreur", async () => {
    const ids = await seedAccountingTenant(db, "acc-010-erreurs");

    const analysis = await analyzeAccounts(ids, [
      accountRow(2, { code: "901000", libelle: "Classe interdite" }),
      accountRow(3, { code: "421000", libelle: "Clients douteux" }),
      accountRow(4, { code: "421000", libelle: "Doublon" }),
    ]);
    expect(analysis.errorCount).toBe(3);
    expect(analysis.notes.join(" ")).not.toContain("sera créé");

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.map((row) => row.status)).toEqual(["error", "error", "error"]);
    expect(detail?.rows[0]?.errors.join(" ")).toContain("2 à 10 chiffres");
    expect(detail?.rows[1]?.errors.join(" ")).toContain("présent plusieurs fois");

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/en erreur/);

    const accounts = await db
      .select({ value: count() })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, ids.tenantId));
    expect(accounts[0]?.value).toBe(6);
  });

  it("met à jour un code existant sans doublon et audite le lot", async () => {
    const ids = await seedAccountingTenant(db, "acc-010-application");
    const other = await seedAccountingTenant(db, "acc-010-voisin");

    const rows = [
      accountRow(2, { libelle: "Clients mis à jour", actif: "Non" }),
      accountRow(3, { code: "421000", libelle: "Clients douteux", actif: "Oui" }),
      accountRow(4, { code: "701000", libelle: "Ventes de marchandises" }),
    ];
    const hash = hashOf("acc-010-application");
    const analysis = await analyzeAccounts(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);
    expect(analysis.notes.join(" ")).toContain("3 comptes seront créés ou mis à jour");

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ kind: "accounts", written: 3 });

    const accounts = await db
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        label: ledgerAccounts.label,
        accountClass: ledgerAccounts.accountClass,
        active: ledgerAccounts.active,
      })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, ids.tenantId))
      .orderBy(asc(ledgerAccounts.code));
    expect(accounts).toHaveLength(7);
    expect(accounts.find((account) => account.code === "411000")).toMatchObject({
      label: "Clients mis à jour",
      active: false,
    });
    expect(accounts.find((account) => account.code === "421000")).toMatchObject({
      accountClass: 4,
      active: true,
    });
    expect(accounts.find((account) => account.code === "571000")).toMatchObject({
      label: "Caisse",
      active: false,
    });

    const linked = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linked).toHaveLength(3);
    expect(linked.every((row) => row.entityId !== null)).toBe(true);

    const audit = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.account.import"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({
      source: "xlsx_import",
      written: 3,
      codes: ["411000", "421000", "701000"],
    });

    const otherAccounts = await db
      .select({ label: ledgerAccounts.label })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, other.tenantId), eq(ledgerAccounts.code, "411000")));
    expect(otherAccounts).toEqual([{ label: "Clients" }]);

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);

    const duplicate = await analyzeAccounts(ids, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: duplicate.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été importé en plan comptable/);
  });
});

describe("ACC-009 — import XLSX des écritures", () => {
  it("produit un modèle à neuf colonnes", async () => {
    expect([...JOURNAL_ENTRY_HEADERS]).toEqual([
      "journal",
      "date",
      "piece",
      "libelle",
      "libelle_ligne",
      "compte",
      "tiers",
      "debit",
      "credit",
    ]);
    expect([...HEADERS_BY_KIND.journal_entries]).toEqual([...JOURNAL_ENTRY_HEADERS]);

    const workbook = await loadWorkbook(await buildTemplate("journal_entries"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    const headers = JOURNAL_ENTRY_HEADERS.map(
      (_, index) => data?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...JOURNAL_ENTRY_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getColumn(2).numFmt).toBe("@");
    expect(data?.getColumn(6).numFmt).toBe("@");
  });

  it("rejette les lignes bloquantes sans rien écrire", async () => {
    const ids = await seedAccountingTenant(db, "acc-009-erreurs");

    const rows = [
      entryRow(2, { journal: "ZZ" }),
      entryRow(3, { date: "2025-06-01" }),
      entryRow(4, { compte: "999999" }),
      entryRow(5, { tiers: "INCONNU" }),
      entryRow(6, { debit: "1000", credit: "1000" }),
      entryRow(7, { debit: "", credit: "" }),
      entryRow(8, { journal: "OD" }),
      entryRow(9, { compte: "571000" }),
    ];
    const analysis = await analyzeEntries(ids, rows, hashOf("acc-009-erreurs"));
    expect(analysis.errorCount).toBe(8);
    expect(await entryCount(ids.tenantId)).toBe(0);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    const messages = detail?.rows.map((row) => row.errors.join(" ")) ?? [];
    expect(messages[0]).toContain("Journal ZZ inconnu");
    expect(messages[1]).toContain("aucun exercice ouvert ne couvre le 2025-06-01");
    expect(messages[2]).toContain("Compte 999999 inconnu");
    expect(messages[3]).toContain("Tiers INCONNU inconnu");
    expect(messages[4]).toContain("un seul montant par ligne");
    expect(messages[5]).toContain("strictement positif");
    expect(messages[6]).toContain("OD inactif");
    expect(messages[7]).toContain("571000 inactif");

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/en erreur/);
  });

  it("signale une écriture déséquilibrée ou solitaire sur toutes ses lignes", async () => {
    const ids = await seedAccountingTenant(db, "acc-009-groupes");

    const unbalanced = await analyzeEntries(
      ids,
      [
        entryRow(2, { debit: "100000", credit: "" }),
        entryRow(3, { compte: "701000", tiers: "", debit: "", credit: "90000" }),
        entryRow(4, {
          piece: "FAC-SEUL",
          libelle: "Écriture solitaire",
          debit: "5000",
          credit: "",
        }),
      ],
      hashOf("acc-009-groupes"),
    );
    expect(unbalanced.errorCount).toBe(3);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: unbalanced.batchId,
    });
    expect(detail?.rows[0]?.errors.join(" ")).toContain("déséquilibrée");
    expect(detail?.rows[0]?.errors.join(" ")).toContain("débit 100000 XOF");
    expect(detail?.rows[2]?.errors.join(" ")).toContain("au moins deux lignes valides");
  });

  it("crée des brouillons numérotés, un audit par écriture, sans validation", async () => {
    const ids = await seedAccountingTenant(db, "acc-009-application");

    const rows = [
      entryRow(2),
      entryRow(3, {
        compte: "701000",
        tiers: "",
        libelle_ligne: "Vente",
        debit: "",
        credit: "150000",
      }),
      entryRow(4, {
        journal: "BQ",
        date: "2026-06-16",
        piece: "",
        libelle: "Encaissement du 16/06",
        libelle_ligne: "Encaissement",
        compte: "521000",
        tiers: "",
        debit: "150000",
        credit: "",
      }),
      entryRow(5, {
        journal: "BQ",
        date: "2026-06-16",
        piece: "",
        libelle: "Encaissement du 16/06",
        libelle_ligne: "Extinction de la créance",
        compte: "411000",
        tiers: "cli001",
        debit: "",
        credit: "150000",
      }),
    ];
    const hash = hashOf("acc-009-application");
    const analysis = await analyzeEntries(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.notes.join(" ")).toContain("2 écritures en brouillon");
    expect(await entryCount(ids.tenantId)).toBe(0);

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ kind: "journal_entries", written: 4 });

    const entries = await db
      .select({
        id: journalEntries.id,
        number: journalEntries.number,
        status: journalEntries.status,
        totalDebit: journalEntries.totalDebit,
        totalCredit: journalEntries.totalCredit,
        label: journalEntries.label,
      })
      .from(journalEntries)
      .where(eq(journalEntries.tenantId, ids.tenantId))
      .orderBy(asc(journalEntries.number));
    expect(entries.map((entry) => entry.number)).toEqual(["BQ-2026-0001", "VE-2026-0001"]);
    expect(entries.every((entry) => entry.status === "draft")).toBe(true);
    expect(entries.every((entry) => entry.totalDebit === entry.totalCredit)).toBe(true);

    const linked = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    const ve = entries.find((entry) => entry.number === "VE-2026-0001");
    const bq = entries.find((entry) => entry.number === "BQ-2026-0001");
    expect(linked.map((row) => row.entityId)).toEqual([ve?.id, ve?.id, bq?.id, bq?.id]);

    const audits = await db
      .select({ entityId: auditEvents.entityId, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "accounting.entry.create"),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(
      audits.every(
        (audit) =>
          (audit.details as { source?: string }).source === "xlsx_import" &&
          (audit.details as { batchId?: string }).batchId === analysis.batchId,
      ),
    ).toBe(true);

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);

    const duplicate = await analyzeEntries(ids, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: duplicate.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été importé en écritures/);
    expect(await entryCount(ids.tenantId)).toBe(2);
  });
});
