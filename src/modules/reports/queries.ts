import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  fiscalYears,
  invoicePayments,
  invoices,
  journalEntries,
  journalEntryLines,
  ledgerAccounts,
  partners,
  purchaseOrderLines,
  purchaseOrders,
} from "@/db/schema";
import type { FiscalYearStatus } from "@/db/schema";
import {
  buildAgedReceivables,
  buildIncomeStatement,
  buildSupplierCommitments,
  type CommitmentLineInput,
  type IncomeStatement,
  type SupplierCommitments,
  type AgedReceivables,
} from "./calculation";

export interface ReportFiscalYear {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: FiscalYearStatus;
}

export interface IncomeStatementReport extends IncomeStatement {
  readonly fiscalYear: ReportFiscalYear;
}

export interface AgedReceivablesReport extends AgedReceivables {
  readonly referenceDate: string;
}

export interface SupplierCommitmentsReport extends SupplierCommitments {
  readonly referenceDate: string;
}

export async function getIncomeStatement(
  db: Database,
  input: { readonly tenantId: string; readonly fiscalYearId: string },
): Promise<IncomeStatementReport | null> {
  const [year] = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)))
    .limit(1);
  if (!year) {
    return null;
  }

  const balances = await db
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

  const statement = buildIncomeStatement(
    balances.map((row) => ({
      ...row,
      debit: Number(row.debit),
      credit: Number(row.credit),
    })),
  );

  return { fiscalYear: year, ...statement };
}

async function paidByInvoice(
  db: Database,
  tenantId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      invoiceId: invoicePayments.invoiceId,
      paid: sql<string>`sum(${invoicePayments.amountXof})`,
    })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.tenantId, tenantId),
        inArray(invoicePayments.invoiceId, [...invoiceIds]),
      ),
    )
    .groupBy(invoicePayments.invoiceId);
  return new Map(rows.map((row) => [row.invoiceId, Number(row.paid ?? 0)]));
}

export async function getAgedReceivables(
  db: Database,
  input: { readonly tenantId: string; readonly referenceDate: string },
): Promise<AgedReceivablesReport> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      totalXof: invoices.exTaxTotal,
      customerCode: partners.code,
      customerName: partners.name,
    })
    .from(invoices)
    .innerJoin(
      partners,
      and(eq(partners.tenantId, invoices.tenantId), eq(partners.id, invoices.customerId)),
    )
    .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.status, "validated")))
    .orderBy(asc(invoices.dueDate), asc(invoices.invoiceDate), asc(invoices.number));

  const paid = await paidByInvoice(
    db,
    input.tenantId,
    rows.map((row) => row.id),
  );

  return {
    referenceDate: input.referenceDate,
    ...buildAgedReceivables(
      rows.map((row) => ({ ...row, paidXof: paid.get(row.id) ?? 0 })),
      input.referenceDate,
    ),
  };
}

export async function getSupplierCommitments(
  db: Database,
  input: { readonly tenantId: string; readonly referenceDate: string },
): Promise<SupplierCommitmentsReport> {
  const orders = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      orderDate: purchaseOrders.orderDate,
      expectedReceiptDate: purchaseOrders.expectedReceiptDate,
      supplierCode: partners.code,
      supplierName: partners.name,
    })
    .from(purchaseOrders)
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.tenantId, input.tenantId),
        eq(purchaseOrders.status, "confirmed"),
        ne(purchaseOrders.receiptState, "received"),
      ),
    )
    .orderBy(asc(partners.name), asc(purchaseOrders.orderDate), asc(purchaseOrders.number));

  const orderIds = orders.map((order) => order.id);
  const lineRows = orderIds.length
    ? await db
        .select({
          orderId: purchaseOrderLines.orderId,
          qty: purchaseOrderLines.qty,
          receivedQty: purchaseOrderLines.receivedQty,
          unitPriceXof: purchaseOrderLines.unitPriceXof,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.tenantId, input.tenantId),
            inArray(purchaseOrderLines.orderId, orderIds),
          ),
        )
        .orderBy(asc(purchaseOrderLines.lineNumber))
    : [];

  const linesByOrder = new Map<string, CommitmentLineInput[]>();
  for (const line of lineRows) {
    const lines = linesByOrder.get(line.orderId) ?? [];
    lines.push({ qty: line.qty, receivedQty: line.receivedQty, unitPriceXof: line.unitPriceXof });
    linesByOrder.set(line.orderId, lines);
  }

  return {
    referenceDate: input.referenceDate,
    ...buildSupplierCommitments(
      orders.map((order) => ({ ...order, lines: linesByOrder.get(order.id) ?? [] })),
      input.referenceDate,
    ),
  };
}
