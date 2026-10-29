import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accountingJournals,
  invoicePayments,
  invoices,
  partners,
  purchaseOrderLines,
  purchaseOrders,
} from "@/db/schema";
import type { InvoiceStatus, PurchaseOrderStatus, ReceiptState } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedAccountingTenant, type AccountingTenant } from "@/test/accounting";
import { seedSalesTenant, type SalesTenant } from "@/test/sales";
import { todayIsoDate } from "@/lib/dates";
import { createSalesOrder, transitionSalesOrder } from "@/modules/sales/queries";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  transitionPurchaseOrder,
} from "@/modules/purchases/queries";
import { createReception } from "@/modules/stock/receptions";
import { createAccount, insertJournalEntry } from "@/modules/accounting/queries";
import {
  agingBucketFor,
  buildAgedReceivables,
  buildIncomeStatement,
  buildSupplierCommitments,
  summarizeByCustomer,
} from "./calculation";
import { REPORT_KINDS, REPORT_KIND_LABELS, REPORT_SHEET_NAMES, isReportKind } from "./constants";
import {
  agedReceivablesFileName,
  buildAgedReceivablesWorkbook,
  buildIncomeStatementWorkbook,
  buildSupplierCommitmentsWorkbook,
  incomeStatementFileName,
  supplierCommitmentsFileName,
} from "./exports";
import { getAgedReceivables, getIncomeStatement, getSupplierCommitments } from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

const REFERENCE = "2026-06-30";

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(data.slice().buffer as ArrayBuffer);
  return workbook;
}

function firstColumn(sheet: Workbook["worksheets"][number] | undefined): (string | undefined)[] {
  return (sheet?.getSheetValues() ?? []).map((row) =>
    Array.isArray(row) && typeof row[1] === "string" ? row[1] : undefined,
  );
}

async function saleJournal(ids: AccountingTenant): Promise<{ id: string; code: string }> {
  const [journal] = await db
    .select({ id: accountingJournals.id, code: accountingJournals.code })
    .from(accountingJournals)
    .where(and(eq(accountingJournals.tenantId, ids.tenantId), eq(accountingJournals.code, "VE")))
    .limit(1);
  if (!journal) {
    throw new Error("Journal de test absent.");
  }
  return journal;
}

async function insertValidatedEntry(
  ids: AccountingTenant,
  entryDate: string,
  lines: readonly { accountId: string; debit: number; credit: number }[],
): Promise<void> {
  const journal = await saleJournal(ids);
  await db.transaction(async (tx) => {
    await insertJournalEntry(tx, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      journalId: journal.id,
      journalCode: journal.code,
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

async function salesOrderOf(ids: SalesTenant, customerId?: string): Promise<string> {
  const created = await createSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      customerId: customerId ?? ids.customerId,
      expectedDeliveryDate: "",
      externalReference: "",
      incoterm: "",
      notes: "",
      lines: [{ articleId: ids.productId, qty: "5", unitPriceXof: 1500 }],
    },
  });
  await transitionSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: created.id,
    action: "confirm",
  });
  return created.id;
}

async function addCustomer(ids: SalesTenant, code: string, name: string): Promise<string> {
  const [created] = await db
    .insert(partners)
    .values({
      tenantId: ids.tenantId,
      code,
      name,
      type: "company",
      isCustomer: true,
    })
    .returning({ id: partners.id });
  if (!created) {
    throw new Error("Client de test absent.");
  }
  return created.id;
}

interface InvoiceSeed {
  readonly number: string | null;
  readonly customerId: string;
  readonly status: InvoiceStatus;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly totalXof: number;
}

async function insertInvoice(
  ids: SalesTenant,
  orderId: string,
  seed: InvoiceSeed,
): Promise<string> {
  const [created] = await db
    .insert(invoices)
    .values({
      tenantId: ids.tenantId,
      number: seed.number,
      orderId,
      customerId: seed.customerId,
      status: seed.status,
      invoiceDate: seed.invoiceDate,
      dueDate: seed.dueDate,
      exTaxTotal: seed.totalXof,
      createdBy: ids.userId,
      validatedBy: seed.status === "validated" ? ids.userId : null,
      validatedAt: seed.status === "validated" ? new Date("2026-06-01T08:00:00Z") : null,
    })
    .returning({ id: invoices.id });
  if (!created) {
    throw new Error("Facture de test non créée.");
  }
  return created.id;
}

async function insertPayment(
  ids: SalesTenant,
  invoiceId: string,
  amountXof: number,
): Promise<void> {
  await db.insert(invoicePayments).values({
    tenantId: ids.tenantId,
    invoiceId,
    amountXof,
    paidDate: REFERENCE,
    method: "transfer",
    reference: `REG-${amountXof}`,
    createdBy: ids.userId,
  });
}

async function purchaseOrderSeed(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly supplierId: string;
  readonly number: string;
  readonly status: PurchaseOrderStatus;
  readonly receiptState: ReceiptState;
  readonly expectedReceiptDate: string | null;
  readonly lines: readonly {
    articleId: string;
    qty: string;
    receivedQty: string;
    unitPriceXof: number;
  }[];
}): Promise<void> {
  const [created] = await db
    .insert(purchaseOrders)
    .values({
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      number: input.number,
      status: input.status,
      receiptState: input.receiptState,
      orderDate: "2026-05-05",
      expectedReceiptDate: input.expectedReceiptDate,
      exTaxTotal: input.lines.reduce((sum, line) => sum + Number(line.qty) * line.unitPriceXof, 0),
      createdBy: input.userId,
    })
    .returning({ id: purchaseOrders.id });
  if (!created) {
    throw new Error("Commande d'achat de test non créée.");
  }
  await db.insert(purchaseOrderLines).values(
    input.lines.map((line, index) => ({
      tenantId: input.tenantId,
      orderId: created.id,
      lineNumber: index + 1,
      articleId: line.articleId,
      name: `Article ${index + 1}`,
      unitCode: "KG",
      qty: line.qty,
      unitPriceXof: line.unitPriceXof,
      lineTotalXof: Number(line.qty) * line.unitPriceXof,
      receivedQty: line.receivedQty,
    })),
  );
}

async function firstLineOf(orderId: string): Promise<string> {
  const [line] = await db
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, orderId))
    .limit(1);
  if (!line) {
    throw new Error("Ligne de commande de test absente.");
  }
  return line.id;
}

describe("RPT-001 — compte de résultat calculé depuis les écritures validées", () => {
  it("solde les charges, produits et classe 8, et équilibre avec les classes 1 à 5", () => {
    const statement = buildIncomeStatement([
      {
        accountId: "a",
        code: "401000",
        label: "Fournisseurs",
        accountClass: 4,
        debit: 0,
        credit: 50,
      },
      { accountId: "b", code: "411000", label: "Clients", accountClass: 4, debit: 200, credit: 0 },
      {
        accountId: "c",
        code: "521000",
        label: "Banque",
        accountClass: 5,
        debit: 0,
        credit: 70,
      },
      { accountId: "d", code: "601000", label: "Achats", accountClass: 6, debit: 100, credit: 0 },
      {
        accountId: "e",
        code: "701000",
        label: "Ventes",
        accountClass: 7,
        debit: 0,
        credit: 150,
      },
      {
        accountId: "f",
        code: "801000",
        label: "Produit hors activité",
        accountClass: 8,
        debit: 0,
        credit: 30,
      },
    ]);

    expect(statement.charges).toBe(100);
    expect(statement.produits).toBe(180);
    expect(statement.result).toBe(80);
    expect(statement.balanceSheetBalance).toBe(-80);
    expect(statement.rows.map((row) => row.code)).toEqual(["601000", "701000", "801000"]);
    expect(statement.rows.map((row) => row.produitXof)).toEqual([0, 150, 30]);
  });

  it("laisse un compte de charge créditeur réduire les charges et accepte la perte", () => {
    const creditCharge = buildIncomeStatement([
      { accountId: "a", code: "411000", label: "Clients", accountClass: 4, debit: 50, credit: 0 },
      {
        accountId: "b",
        code: "521000",
        label: "Banque",
        accountClass: 5,
        debit: 0,
        credit: 20,
      },
      { accountId: "c", code: "601000", label: "Achats", accountClass: 6, debit: 30, credit: 50 },
      { accountId: "d", code: "701000", label: "Ventes", accountClass: 7, debit: 0, credit: 10 },
    ]);
    expect(creditCharge.charges).toBe(-20);
    expect(creditCharge.result).toBe(30);
    expect(creditCharge.balanceSheetBalance).toBe(-30);

    const deficit = buildIncomeStatement([
      {
        accountId: "a",
        code: "401000",
        label: "Fournisseurs",
        accountClass: 4,
        debit: 0,
        credit: 20,
      },
      { accountId: "b", code: "601000", label: "Achats", accountClass: 6, debit: 120, credit: 0 },
      { accountId: "c", code: "701000", label: "Ventes", accountClass: 7, debit: 0, credit: 100 },
    ]);
    expect(deficit.result).toBe(-20);
    expect(deficit.balanceSheetBalance).toBe(20);
    expect(deficit.rows.find((row) => row.code === "701000")?.produitXof).toBe(100);
  });

  it("ignore un solde nul et produit un résultat à l'équilibre", () => {
    const statement = buildIncomeStatement([
      { accountId: "a", code: "411000", label: "Clients", accountClass: 4, debit: 250, credit: 0 },
      {
        accountId: "b",
        code: "521000",
        label: "Banque",
        accountClass: 5,
        debit: 0,
        credit: 100,
      },
      { accountId: "c", code: "601000", label: "Achats", accountClass: 6, debit: 100, credit: 100 },
      { accountId: "d", code: "701000", label: "Ventes", accountClass: 7, debit: 0, credit: 150 },
    ]);
    expect(statement.rows.map((row) => row.code)).toEqual(["701000"]);
    expect(statement.charges).toBe(0);
    expect(statement.result).toBe(150);
    expect(statement.balanceSheetBalance).toBe(-150);
  });

  it("bascule le solde débiteur de classe 8 en charge hors activité ordinaire", () => {
    const statement = buildIncomeStatement([
      {
        accountId: "a",
        code: "802000",
        label: "Perte hors activité",
        accountClass: 8,
        debit: 45,
        credit: 0,
      },
      {
        accountId: "b",
        code: "411000",
        label: "Clients",
        accountClass: 4,
        debit: 0,
        credit: 45,
      },
    ]);
    expect(statement.charges).toBe(45);
    expect(statement.produits).toBe(0);
    expect(statement.result).toBe(-45);
    expect(statement.balanceSheetBalance).toBe(45);
    expect(statement.rows[0]).toMatchObject({ chargeXof: 45, produitXof: 0 });
  });

  it("ignore les brouillons et l'exercice d'un autre espace, sans rien stocker", async () => {
    const ids = await seedAccountingTenant(db, "rpt-001");
    const other = await seedAccountingTenant(db, "rpt-001-voisin");
    const horsActivite = await createAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "801000", label: "Charges hors activité ordinaire", active: true },
    });

    await insertValidatedEntry(ids, "2026-03-10", [
      { accountId: ids.clientAccountId, debit: 150_000, credit: 0 },
      { accountId: ids.salesAccountId, debit: 0, credit: 150_000 },
    ]);
    await insertValidatedEntry(ids, "2026-04-10", [
      { accountId: ids.purchaseAccountId, debit: 100_000, credit: 0 },
      { accountId: ids.bankAccountId, debit: 0, credit: 100_000 },
    ]);
    await insertValidatedEntry(ids, "2026-05-10", [
      { accountId: horsActivite.id, debit: 20_000, credit: 0 },
      { accountId: ids.supplierAccountId, debit: 0, credit: 20_000 },
    ]);

    const journal = await saleJournal(ids);
    await db.transaction(async (tx) => {
      await insertJournalEntry(tx, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        journalId: journal.id,
        journalCode: journal.code,
        fiscalYearId: ids.fiscalYear2026Id,
        fiscalYearLabel: "Exercice 2026",
        entryDate: "2026-06-10",
        reference: null,
        label: "Brouillon hors état",
        lines: [
          {
            accountId: ids.purchaseAccountId,
            partnerId: null,
            label: null,
            debit: 900,
            credit: 0,
          },
          {
            accountId: ids.bankAccountId,
            partnerId: null,
            label: null,
            debit: 0,
            credit: 900,
          },
        ],
        source: "manual",
      });
    });

    const report = await getIncomeStatement(db, {
      tenantId: ids.tenantId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    expect(report?.charges).toBe(120_000);
    expect(report?.produits).toBe(150_000);
    expect(report?.result).toBe(30_000);
    expect(report?.balanceSheetBalance).toBe(-30_000);
    expect(report?.rows.map((row) => row.code)).toEqual(["601000", "701000", "801000"]);

    expect(
      (
        await getIncomeStatement(db, {
          tenantId: other.tenantId,
          fiscalYearId: other.fiscalYear2026Id,
        })
      )?.rows,
    ).toHaveLength(0);
    expect(
      await getIncomeStatement(db, {
        tenantId: ids.tenantId,
        fiscalYearId: other.fiscalYear2026Id,
      }),
    ).toBeNull();

    const replay = await getIncomeStatement(db, {
      tenantId: ids.tenantId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    expect(replay).toEqual(report);
  });
});

describe("RPT-002 — balance âgée des créances clients", () => {
  it("classe chaque échéance par tranche d'ancienneté à ses bornes", () => {
    expect(agingBucketFor("2026-07-01", REFERENCE)).toEqual({ bucket: "not_due", overdueDays: 0 });
    expect(agingBucketFor("2026-06-30", REFERENCE)).toEqual({
      bucket: "not_due",
      overdueDays: 0,
    });
    expect(agingBucketFor("2026-06-20", REFERENCE)).toEqual({ bucket: "d1_30", overdueDays: 10 });
    expect(agingBucketFor("2026-06-29", REFERENCE)).toEqual({ bucket: "d1_30", overdueDays: 1 });
    expect(agingBucketFor("2026-05-31", REFERENCE)).toEqual({ bucket: "d1_30", overdueDays: 30 });
    expect(agingBucketFor("2026-05-30", REFERENCE)).toEqual({ bucket: "d31_60", overdueDays: 31 });
    expect(agingBucketFor("2026-05-01", REFERENCE)).toEqual({ bucket: "d31_60", overdueDays: 60 });
    expect(agingBucketFor("2026-04-30", REFERENCE)).toEqual({ bucket: "d61_90", overdueDays: 61 });
    expect(agingBucketFor("2026-04-01", REFERENCE)).toEqual({ bucket: "d61_90", overdueDays: 90 });
    expect(agingBucketFor("2026-03-31", REFERENCE)).toEqual({
      bucket: "d90_plus",
      overdueDays: 91,
    });
  });

  it("prend le jour d'Abidjan comme date de référence", () => {
    expect(todayIsoDate(new Date("2026-06-30T23:59:59Z"))).toBe("2026-06-30");
    expect(todayIsoDate(new Date("2026-07-01T00:00:01Z"))).toBe("2026-07-01");
  });

  it("exclut les soldes nuls ou négatifs et totalise par tranche", () => {
    const report = buildAgedReceivables(
      [
        {
          id: "1",
          number: "FAC-2026-0001",
          customerCode: "CUST001",
          customerName: "Client seulement",
          invoiceDate: "2026-01-10",
          dueDate: "2026-05-31",
          totalXof: 1000,
          paidXof: 400,
        },
        {
          id: "2",
          number: "FAC-2026-0002",
          customerCode: "CUST001",
          customerName: "Client seulement",
          invoiceDate: "2026-01-10",
          dueDate: "2026-05-31",
          totalXof: 1000,
          paidXof: 1000,
        },
        {
          id: "3",
          number: "FAC-2026-0003",
          customerCode: "CUST001",
          customerName: "Client seulement",
          invoiceDate: "2026-01-10",
          dueDate: "2026-06-01",
          totalXof: 1000,
          paidXof: 1500,
        },
      ],
      REFERENCE,
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ balanceXof: 600, bucket: "d1_30", overdueDays: 30 });
    expect(report.totals.d1_30).toBe(600);
    expect(report.totalXof).toBe(600);
    expect(report.overdueXof).toBe(600);
  });

  it("retient les factures validées, déduit les règlements et isole par espace", async () => {
    const ids = await seedSalesTenant(db, "rpt-002");
    const other = await seedSalesTenant(db, "rpt-002-voisin");
    const orderId = await salesOrderOf(ids);

    const seeds: InvoiceSeed[] = [
      {
        number: "FAC-2026-0001",
        customerId: ids.customerId,
        status: "draft",
        invoiceDate: "2026-01-05",
        dueDate: "2026-02-04",
        totalXof: 5000,
      },
      {
        number: "FAC-2026-0002",
        customerId: ids.customerId,
        status: "cancelled",
        invoiceDate: "2026-01-05",
        dueDate: "2026-02-04",
        totalXof: 6000,
      },
      {
        number: "FAC-2026-0003",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-05-31",
        dueDate: REFERENCE,
        totalXof: 1000,
      },
      {
        number: "FAC-2026-0004",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-05-21",
        dueDate: "2026-06-20",
        totalXof: 2000,
      },
      {
        number: "FAC-2026-0005",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-04-21",
        dueDate: "2026-05-30",
        totalXof: 3000,
      },
      {
        number: "FAC-2026-0006",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-03-02",
        dueDate: "2026-04-01",
        totalXof: 4000,
      },
      {
        number: "FAC-2026-0007",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-02-28",
        dueDate: "2026-03-30",
        totalXof: 5000,
      },
      {
        number: "FAC-2026-0008",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-01-10",
        dueDate: "2026-02-09",
        totalXof: 1000,
      },
      {
        number: "FAC-2026-0009",
        customerId: ids.customerId,
        status: "validated",
        invoiceDate: "2026-01-11",
        dueDate: "2026-02-10",
        totalXof: 1000,
      },
    ];
    const created = new Map<string, string>();
    for (const seed of seeds) {
      created.set(seed.number ?? "", await insertInvoice(ids, orderId, seed));
    }
    const invoice8 = created.get("FAC-2026-0008");
    const invoice9 = created.get("FAC-2026-0009");
    if (!invoice8 || !invoice9) {
      throw new Error("Factures de test absentes.");
    }
    await insertPayment(ids, invoice8, 1000);
    await insertPayment(ids, invoice9, 1500);

    const report = await getAgedReceivables(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    expect(report.rows.map((row) => row.number)).toEqual([
      "FAC-2026-0007",
      "FAC-2026-0006",
      "FAC-2026-0005",
      "FAC-2026-0004",
      "FAC-2026-0003",
    ]);
    expect(report.rows.map((row) => row.bucket)).toEqual([
      "d90_plus",
      "d61_90",
      "d31_60",
      "d1_30",
      "not_due",
    ]);
    expect(report.totals).toEqual({
      not_due: 1000,
      d1_30: 2000,
      d31_60: 3000,
      d61_90: 4000,
      d90_plus: 5000,
    });
    expect(report.totalXof).toBe(15000);
    expect(report.overdueXof).toBe(14000);
    expect(report.referenceDate).toBe(REFERENCE);

    const otherReport = await getAgedReceivables(db, {
      tenantId: other.tenantId,
      referenceDate: REFERENCE,
    });
    expect(otherReport.rows).toHaveLength(0);
  });

  it("détaille par client puis par échéance et sous-totalise chaque tranche par client", async () => {
    const ids = await seedSalesTenant(db, "rpt-002-clients");
    const orderId = await salesOrderOf(ids);
    const atlasId = await addCustomer(ids, "CLI-ATLAS", "Atlas Distribution");
    const atlasOrderId = await salesOrderOf(ids, atlasId);

    await insertInvoice(ids, orderId, {
      number: "FAC-2026-0030",
      customerId: ids.customerId,
      status: "validated",
      invoiceDate: "2026-02-15",
      dueDate: "2026-03-15",
      totalXof: 6000,
    });
    await insertInvoice(ids, orderId, {
      number: "FAC-2026-0031",
      customerId: ids.customerId,
      status: "validated",
      invoiceDate: "2026-06-15",
      dueDate: "2026-06-25",
      totalXof: 4000,
    });
    await insertInvoice(ids, atlasOrderId, {
      number: "FAC-2026-0032",
      customerId: atlasId,
      status: "validated",
      invoiceDate: "2026-05-20",
      dueDate: "2026-06-30",
      totalXof: 2000,
    });

    const report = await getAgedReceivables(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    expect(report.rows.map((row) => row.number)).toEqual([
      "FAC-2026-0032",
      "FAC-2026-0030",
      "FAC-2026-0031",
    ]);
    expect(report.totals).toEqual({
      not_due: 2000,
      d1_30: 4000,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 6000,
    });
    expect(report.totalXof).toBe(12000);
    expect(report.overdueXof).toBe(10000);

    expect(summarizeByCustomer(report.rows)).toEqual([
      {
        customerCode: "CLI-ATLAS",
        customerName: "Atlas Distribution",
        invoiceCount: 1,
        totals: { not_due: 2000, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
        totalXof: 2000,
      },
      {
        customerCode: "CUST001",
        customerName: "Client seulement",
        invoiceCount: 2,
        totals: { not_due: 0, d1_30: 4000, d31_60: 0, d61_90: 0, d90_plus: 6000 },
        totalXof: 10000,
      },
    ]);
  });
});

describe("RPT-003 — engagements fournisseurs", () => {
  it("valeurise le reliquat au prix de commande et signale le retard", () => {
    const commitments = buildSupplierCommitments(
      [
        {
          id: "1",
          number: "CMD-2026-0001",
          supplierCode: "FOUR001",
          supplierName: "Sahel Négoce SARL",
          orderDate: "2026-05-05",
          expectedReceiptDate: "2026-06-01",
          lines: [
            { qty: "5", receivedQty: "1", unitPriceXof: 1000 },
            { qty: "2", receivedQty: "2", unitPriceXof: 450 },
            { qty: "1", receivedQty: "0", unitPriceXof: 333 },
          ],
        },
        {
          id: "2",
          number: "CMD-2026-0002",
          supplierCode: "FOUR001",
          supplierName: "Sahel Négoce SARL",
          orderDate: "2026-05-05",
          expectedReceiptDate: null,
          lines: [{ qty: "1", receivedQty: "0", unitPriceXof: 100 }],
        },
        {
          id: "3",
          number: "CMD-2026-0003",
          supplierCode: "FOUR001",
          supplierName: "Sahel Négoce SARL",
          orderDate: "2026-05-05",
          expectedReceiptDate: "2026-08-01",
          lines: [{ qty: "3", receivedQty: "3", unitPriceXof: 1000 }],
        },
      ],
      REFERENCE,
    );

    expect(commitments.rows.map((row) => row.number)).toEqual(["CMD-2026-0001", "CMD-2026-0002"]);
    expect(commitments.rows[0]).toMatchObject({ amountXof: 4333, lineCount: 2, overdue: true });
    expect(commitments.rows[1]).toMatchObject({ amountXof: 100, overdue: false });
    expect(commitments.totalXof).toBe(4433);
    expect(commitments.overdueXof).toBe(4333);
  });

  it("arrondi HALF_UP le reliquat fractionnaire × prix unitaire", () => {
    const commitments = buildSupplierCommitments(
      [
        {
          id: "1",
          number: "CMD-2026-0001",
          supplierCode: "FOUR001",
          supplierName: "Sahel Négoce SARL",
          orderDate: "2026-05-05",
          expectedReceiptDate: null,
          lines: [{ qty: "1.5", receivedQty: "0", unitPriceXof: 1001 }],
        },
      ],
      REFERENCE,
    );
    expect(commitments.rows[0]?.amountXof).toBe(1502);
  });

  it("retient les commandes confirmées non reçues et exclut les autres statuts", async () => {
    const ids = await seedSalesTenant(db, "rpt-003");

    const partial = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "2026-07-01",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "10", unitPriceXof: 1000 }],
      },
    });
    for (const action of ["request", "confirm"] as const) {
      await transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: partial.id,
        action,
      });
    }
    await createReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: partial.id,
      locationId: ids.locationId,
      receivedDate: "2026-06-01",
      notes: null,
      lines: [{ orderLineId: await firstLineOf(partial.id), qty: "4" }],
    });
    const confirmed = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: partial.id,
    });
    const confirmedNumber = confirmed?.order.number;
    if (!confirmedNumber) {
      throw new Error("Commande confirmée sans numéro.");
    }

    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0100",
      status: "confirmed",
      receiptState: "not_received",
      expectedReceiptDate: "2026-06-01",
      lines: [
        { articleId: ids.productId, qty: "5", receivedQty: "0", unitPriceXof: 1000 },
        { articleId: ids.secondProductId, qty: "4", receivedQty: "0", unitPriceXof: 450 },
      ],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0101",
      status: "draft",
      receiptState: "not_received",
      expectedReceiptDate: "2026-07-01",
      lines: [{ articleId: ids.productId, qty: "9", receivedQty: "0", unitPriceXof: 1000 }],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0102",
      status: "requested",
      receiptState: "not_received",
      expectedReceiptDate: "2026-07-01",
      lines: [{ articleId: ids.productId, qty: "9", receivedQty: "0", unitPriceXof: 1000 }],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0103",
      status: "cancelled",
      receiptState: "not_received",
      expectedReceiptDate: "2026-07-01",
      lines: [{ articleId: ids.productId, qty: "9", receivedQty: "0", unitPriceXof: 1000 }],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0104",
      status: "closed",
      receiptState: "partially_received",
      expectedReceiptDate: "2026-07-01",
      lines: [{ articleId: ids.productId, qty: "9", receivedQty: "1", unitPriceXof: 1000 }],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0105",
      status: "confirmed",
      receiptState: "received",
      expectedReceiptDate: "2026-07-01",
      lines: [{ articleId: ids.productId, qty: "2", receivedQty: "2", unitPriceXof: 1000 }],
    });
    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0106",
      status: "confirmed",
      receiptState: "not_received",
      expectedReceiptDate: null,
      lines: [{ articleId: ids.productId, qty: "1", receivedQty: "0", unitPriceXof: 250 }],
    });

    const report = await getSupplierCommitments(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    expect(report.rows.map((row) => row.number)).toEqual([
      "CMD-2026-0100",
      confirmedNumber,
      "CMD-2026-0106",
    ]);
    expect(report.rows[0]).toMatchObject({ amountXof: 6800, lineCount: 2, overdue: true });
    expect(report.rows[1]).toMatchObject({ amountXof: 6000, overdue: false });
    expect(report.rows[2]).toMatchObject({ amountXof: 250, overdue: false });
    expect(report.totalXof).toBe(13050);
    expect(report.overdueXof).toBe(6800);

    const other = await seedSalesTenant(db, "rpt-003-voisin");
    expect(
      (
        await getSupplierCommitments(db, {
          tenantId: other.tenantId,
          referenceDate: REFERENCE,
        })
      ).rows,
    ).toHaveLength(0);
  });
});

describe("RPT-004 — export XLSX des trois états", () => {
  it("résout les trois états et refuse tout autre type", () => {
    expect([...REPORT_KINDS]).toEqual(["resultat", "creances", "engagements"]);
    expect(isReportKind("resultat")).toBe(true);
    expect(isReportKind("creances")).toBe(true);
    expect(isReportKind("engagements")).toBe(true);
    expect(isReportKind("inconnu")).toBe(false);
    expect(isReportKind("")).toBe(false);
    expect(REPORT_SHEET_NAMES.resultat).toBe("Compte de résultat");
    expect(REPORT_SHEET_NAMES.creances).toBe("Créances clients");
    expect(REPORT_SHEET_NAMES.engagements).toBe("Engagements");
    expect(REPORT_KIND_LABELS.engagements).toBe("Engagements fournisseurs");
  });

  it("reproduit les lignes et totaux de l'écran avec des montants entiers", async () => {
    const ids = await seedAccountingTenant(db, "rpt-004");
    await insertValidatedEntry(ids, "2026-03-10", [
      { accountId: ids.clientAccountId, debit: 150_000, credit: 0 },
      { accountId: ids.salesAccountId, debit: 0, credit: 150_000 },
    ]);
    await insertValidatedEntry(ids, "2026-04-10", [
      { accountId: ids.purchaseAccountId, debit: 50_000, credit: 0 },
      { accountId: ids.bankAccountId, debit: 0, credit: 50_000 },
    ]);

    const report = await getIncomeStatement(db, {
      tenantId: ids.tenantId,
      fiscalYearId: ids.fiscalYear2026Id,
    });
    if (!report) {
      throw new Error("Compte de résultat absent.");
    }
    expect(report.charges).toBe(50_000);
    expect(report.produits).toBe(150_000);
    expect(report.result).toBe(100_000);

    const sheet = (await loadWorkbook(await buildIncomeStatementWorkbook(report))).getWorksheet(
      REPORT_SHEET_NAMES.resultat,
    );
    expect(sheet?.getCell("A1").value).toContain("Compte de résultat");
    expect([
      sheet?.getCell("A4").value,
      sheet?.getCell("B4").value,
      sheet?.getCell("C4").value,
      sheet?.getCell("D4").value,
      sheet?.getCell("E4").value,
      sheet?.getCell("F4").value,
    ]).toEqual(["Compte", "Libellé", "Débit", "Crédit", "Charges", "Produits"]);
    expect(sheet?.getCell("A5").value).toBe("Charges d'exploitation");
    expect(sheet?.getCell("A6").value).toBe("601000");
    expect(sheet?.getCell("E6").value).toBe(50_000);
    expect(Number.isInteger(sheet?.getCell("E6").value)).toBe(true);
    expect(sheet?.getCell("E6").numFmt).toBe("#,##0");
    expect(sheet?.getCell("A7").value).toBe("Produits d'exploitation");
    expect(sheet?.getCell("A8").value).toBe("701000");
    expect(sheet?.getCell("F8").value).toBe(150_000);

    const labels = firstColumn(sheet);
    expect(labels).toContain("Total charges");
    expect(labels).toContain("Total produits");
    expect(labels).toContain("Résultat net : bénéfice");
    const controlIndex = labels.indexOf("Contrôle bilan");
    expect(controlIndex).toBeGreaterThan(0);
    expect(sheet?.getRow(controlIndex).getCell(3).value).toBe(-100_000);
    expect(incomeStatementFileName(report)).toBe("compte-resultat-exercice-2026.xlsx");
  });

  it("exporte la balance âgée et les engagements avec leurs totaux", async () => {
    const ids = await seedSalesTenant(db, "rpt-004-doc");
    const orderId = await salesOrderOf(ids);
    await insertInvoice(ids, orderId, {
      number: "FAC-2026-0101",
      customerId: ids.customerId,
      status: "validated",
      invoiceDate: "2026-05-21",
      dueDate: "2026-06-20",
      totalXof: 2000,
    });
    const receivables = await getAgedReceivables(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    const receivablesSheet = (
      await loadWorkbook(await buildAgedReceivablesWorkbook(receivables))
    ).getWorksheet(REPORT_SHEET_NAMES.creances);
    expect(receivablesSheet?.getCell("A1").value).toBe("Balance âgée des créances clients");
    expect(receivablesSheet?.getCell("A5").value).toBe(receivables.rows[0]?.customerCode);
    expect(receivablesSheet?.getCell("H5").value).toBe(2000);
    expect(receivablesSheet?.getCell("J5").value).toBe("1 à 30 jours");
    const receivablesLabels = firstColumn(receivablesSheet);
    expect(receivablesLabels).toContain("Total");
    const customerSection = receivablesLabels.indexOf("Synthèse par client");
    expect(customerSection).toBeGreaterThan(0);
    const customerRow = receivablesSheet?.getRow(customerSection + 2);
    expect(customerRow?.getCell(1).value).toBe(receivables.rows[0]?.customerCode);
    expect(customerRow?.getCell(4).value).toBe(2000);
    expect(customerRow?.getCell(8).value).toBe(2000);
    expect(customerRow?.getCell(9).value).toBe(1);
    expect(receivablesSheet?.getRow(customerSection + 3).getCell(8).value).toBe(2000);
    expect(agedReceivablesFileName(receivables)).toBe(`balance-agee-creances-${REFERENCE}.xlsx`);

    await purchaseOrderSeed({
      tenantId: ids.tenantId,
      userId: ids.userId,
      supplierId: ids.supplierId,
      number: "CMD-2026-0201",
      status: "confirmed",
      receiptState: "partially_received",
      expectedReceiptDate: "2026-06-01",
      lines: [{ articleId: ids.productId, qty: "5", receivedQty: "2", unitPriceXof: 1000 }],
    });
    const commitments = await getSupplierCommitments(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    const commitmentsSheet = (
      await loadWorkbook(await buildSupplierCommitmentsWorkbook(commitments))
    ).getWorksheet(REPORT_SHEET_NAMES.engagements);
    expect(commitmentsSheet?.getCell("A1").value).toBe("Engagements fournisseurs");
    expect(commitmentsSheet?.getCell("G5").value).toBe(3000);
    expect(commitmentsSheet?.getCell("H5").value).toBe("En retard");
    expect(supplierCommitmentsFileName(commitments)).toBe(
      `engagements-fournisseurs-${REFERENCE}.xlsx`,
    );
  });

  it("pose un état vide sans lever d'exception", async () => {
    const ids = await seedSalesTenant(db, "rpt-004-vide");
    const empty = await getAgedReceivables(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    const receivablesSheet = (
      await loadWorkbook(await buildAgedReceivablesWorkbook(empty))
    ).getWorksheet(REPORT_SHEET_NAMES.creances);
    expect(receivablesSheet?.getCell("A5").value).toContain("Aucune créance");

    const commitments = await getSupplierCommitments(db, {
      tenantId: ids.tenantId,
      referenceDate: REFERENCE,
    });
    const commitmentsSheet = (
      await loadWorkbook(await buildSupplierCommitmentsWorkbook(commitments))
    ).getWorksheet(REPORT_SHEET_NAMES.engagements);
    expect(commitmentsSheet?.getCell("A5").value).toContain("Aucun engagement");

    const accounting = await seedAccountingTenant(db, "rpt-004-vide-compta");
    const emptyResult = await getIncomeStatement(db, {
      tenantId: accounting.tenantId,
      fiscalYearId: accounting.fiscalYear2026Id,
    });
    if (!emptyResult) {
      throw new Error("Compte de résultat vide absent.");
    }
    const resultatSheet = (
      await loadWorkbook(await buildIncomeStatementWorkbook(emptyResult))
    ).getWorksheet(REPORT_SHEET_NAMES.resultat);
    expect(resultatSheet?.getCell("A5").value).toContain("Aucune charge ni produit");
    expect(firstColumn(resultatSheet)).toContain("Résultat net : à l'équilibre");
  });
});
