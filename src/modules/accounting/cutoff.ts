import { and, asc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  fiscalYears,
  invoicePayments,
  invoices,
  journalEntries,
  partners,
  purchaseOrders,
  receptions,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import type { FiscalYearStatus } from "@/db/schema";
import { computeLineTotal } from "@/modules/stock/quantities";
import { AccountingError } from "./errors";
import { loadAccountingSettings } from "./settings";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const CUTOFF_DOCUMENT_KINDS = [
  "sale_invoice",
  "sale_payment",
  "purchase_reception",
] as const;

export type CutoffDocumentKind = (typeof CUTOFF_DOCUMENT_KINDS)[number];

export const CUTOFF_DOCUMENT_KIND_LABELS: Record<CutoffDocumentKind, string> = {
  sale_invoice: "Facture de vente",
  sale_payment: "Règlement client",
  purchase_reception: "Réception d'achat",
};

export interface CutoffDocument {
  readonly kind: CutoffDocumentKind;
  readonly documentId: string;
  readonly number: string | null;
  readonly date: string;
  readonly partnerName: string | null;
  readonly amountXof: number;
  readonly posted: boolean;
  readonly entryId: string | null;
  readonly entryNumber: string | null;
}

export interface CutoffFiscalYear {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: FiscalYearStatus;
}

export interface CutoffDocumentsResult {
  readonly fiscalYear: CutoffFiscalYear;
  readonly documents: readonly CutoffDocument[];
}

async function loadFiscalYear(
  db: Database | Transaction,
  tenantId: string,
  fiscalYearId: string,
): Promise<CutoffFiscalYear> {
  const [year] = await db
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
      status: fiscalYears.status,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, fiscalYearId)))
    .limit(1);
  if (!year) {
    throw new AccountingError("Exercice introuvable dans cet espace.");
  }
  return year;
}

async function saleInvoices(
  db: Database | Transaction,
  tenantId: string,
  year: CutoffFiscalYear,
): Promise<CutoffDocument[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      date: invoices.invoiceDate,
      partnerName: partners.name,
      amount: invoices.exTaxTotal,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
    })
    .from(invoices)
    .leftJoin(
      partners,
      and(eq(partners.tenantId, invoices.tenantId), eq(partners.id, invoices.customerId)),
    )
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, invoices.tenantId),
        eq(journalEntries.source, "sale_invoice"),
        eq(journalEntries.sourceId, invoices.id),
      ),
    )
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.status, "validated"),
        gte(invoices.invoiceDate, year.startsOn),
        lte(invoices.invoiceDate, year.endsOn),
        gt(invoices.exTaxTotal, 0),
      ),
    )
    .orderBy(asc(invoices.invoiceDate), asc(invoices.number));
  return rows.map((row) => ({
    kind: "sale_invoice" as const,
    documentId: row.id,
    number: row.number,
    date: row.date,
    partnerName: row.partnerName,
    amountXof: row.amount,
    posted: row.entryId !== null,
    entryId: row.entryId,
    entryNumber: row.entryNumber,
  }));
}

async function salePayments(
  db: Database | Transaction,
  tenantId: string,
  year: CutoffFiscalYear,
): Promise<CutoffDocument[]> {
  const rows = await db
    .select({
      id: invoicePayments.id,
      invoiceNumber: invoices.number,
      date: invoicePayments.paidDate,
      partnerName: partners.name,
      amount: invoicePayments.amountXof,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
    })
    .from(invoicePayments)
    .innerJoin(
      invoices,
      and(
        eq(invoices.tenantId, invoicePayments.tenantId),
        eq(invoices.id, invoicePayments.invoiceId),
      ),
    )
    .leftJoin(
      partners,
      and(eq(partners.tenantId, invoices.tenantId), eq(partners.id, invoices.customerId)),
    )
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, invoicePayments.tenantId),
        eq(journalEntries.source, "sale_payment"),
        eq(journalEntries.sourceId, invoicePayments.id),
      ),
    )
    .where(
      and(
        eq(invoicePayments.tenantId, tenantId),
        gte(invoicePayments.paidDate, year.startsOn),
        lte(invoicePayments.paidDate, year.endsOn),
        gt(invoicePayments.amountXof, 0),
      ),
    )
    .orderBy(asc(invoicePayments.paidDate), asc(invoices.number));
  return rows.map((row) => ({
    kind: "sale_payment" as const,
    documentId: row.id,
    number: row.invoiceNumber,
    date: row.date,
    partnerName: row.partnerName,
    amountXof: row.amount,
    posted: row.entryId !== null,
    entryId: row.entryId,
    entryNumber: row.entryNumber,
  }));
}

async function receptionValues(
  db: Database | Transaction,
  tenantId: string,
  receptionIds: readonly string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (receptionIds.length === 0) {
    return totals;
  }
  const rows = await db
    .select({
      receptionId: stockMoves.receptionId,
      qty: stockMoveLines.qty,
      unitPriceXof: stockMoveLines.unitPriceXof,
    })
    .from(stockMoveLines)
    .innerJoin(
      stockMoves,
      and(
        eq(stockMoves.tenantId, stockMoveLines.tenantId),
        eq(stockMoves.id, stockMoveLines.moveId),
      ),
    )
    .where(
      and(
        eq(stockMoves.tenantId, tenantId),
        eq(stockMoves.type, "incoming"),
        inArray(stockMoves.receptionId, receptionIds as string[]),
      ),
    );
  for (const row of rows) {
    if (!row.receptionId) {
      continue;
    }
    const total = totals.get(row.receptionId) ?? 0;
    totals.set(row.receptionId, total + computeLineTotal(row.qty, row.unitPriceXof ?? 0));
  }
  return totals;
}

async function purchaseReceptions(
  db: Database | Transaction,
  tenantId: string,
  year: CutoffFiscalYear,
): Promise<CutoffDocument[]> {
  const rows = await db
    .select({
      id: receptions.id,
      number: receptions.number,
      date: receptions.receivedDate,
      partnerName: partners.name,
      entryId: journalEntries.id,
      entryNumber: journalEntries.number,
    })
    .from(receptions)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.tenantId, receptions.tenantId),
        eq(purchaseOrders.id, receptions.orderId),
      ),
    )
    .leftJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.tenantId, receptions.tenantId),
        eq(journalEntries.source, "purchase_reception"),
        eq(journalEntries.sourceId, receptions.id),
      ),
    )
    .where(
      and(
        eq(receptions.tenantId, tenantId),
        gte(receptions.receivedDate, year.startsOn),
        lte(receptions.receivedDate, year.endsOn),
      ),
    )
    .orderBy(asc(receptions.receivedDate), asc(receptions.number));

  const totals = await receptionValues(
    db,
    tenantId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    kind: "purchase_reception" as const,
    documentId: row.id,
    number: row.number,
    date: row.date,
    partnerName: row.partnerName,
    amountXof: totals.get(row.id) ?? 0,
    posted: row.entryId !== null,
    entryId: row.entryId,
    entryNumber: row.entryNumber,
  }));
}

export async function listCutoffDocuments(
  db: Database | Transaction,
  input: { readonly tenantId: string; readonly fiscalYearId: string },
): Promise<CutoffDocumentsResult> {
  const fiscalYear = await loadFiscalYear(db, input.tenantId, input.fiscalYearId);
  const [invoiceRows, paymentRows, receptionRows] = await Promise.all([
    saleInvoices(db, input.tenantId, fiscalYear),
    salePayments(db, input.tenantId, fiscalYear),
    purchaseReceptions(db, input.tenantId, fiscalYear),
  ]);
  const documents = [...invoiceRows, ...paymentRows, ...receptionRows].sort((left, right) => {
    if (left.date === right.date) {
      return left.kind.localeCompare(right.kind);
    }
    return left.date < right.date ? -1 : 1;
  });
  return { fiscalYear, documents };
}

export interface CutoffReport extends CutoffDocumentsResult {
  readonly configured: boolean;
  readonly postedCount: number;
  readonly unpostedCount: number;
  readonly unpostedAmountXof: number;
}

export async function getCutoffReport(
  db: Database,
  input: { readonly tenantId: string; readonly fiscalYearId: string },
): Promise<CutoffReport> {
  const [result, settings] = await Promise.all([
    listCutoffDocuments(db, input),
    loadAccountingSettings(db, input.tenantId),
  ]);
  let postedCount = 0;
  let unpostedCount = 0;
  let unpostedAmountXof = 0;
  for (const document of result.documents) {
    if (document.posted) {
      postedCount += 1;
    } else {
      unpostedCount += 1;
      unpostedAmountXof += document.amountXof;
    }
  }
  return {
    ...result,
    configured: settings !== null,
    postedCount,
    unpostedCount,
    unpostedAmountXof,
  };
}

export interface UnpostedSummary {
  readonly total: number;
  readonly invoices: number;
  readonly payments: number;
  readonly receptions: number;
}

export async function countUnpostedDocuments(
  db: Database | Transaction,
  input: { readonly tenantId: string; readonly fiscalYearId: string },
): Promise<UnpostedSummary> {
  const { documents } = await listCutoffDocuments(db, input);
  const summary = { total: 0, invoices: 0, payments: 0, receptions: 0 };
  for (const document of documents) {
    if (document.posted) {
      continue;
    }
    summary.total += 1;
    if (document.kind === "sale_invoice") {
      summary.invoices += 1;
    } else if (document.kind === "sale_payment") {
      summary.payments += 1;
    } else {
      summary.receptions += 1;
    }
  }
  return summary;
}
