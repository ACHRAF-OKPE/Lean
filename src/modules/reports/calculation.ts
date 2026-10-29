import { computeLineTotal, remainingQuantity } from "@/modules/stock/quantities";
import { AGING_BUCKETS, type AgingBucket } from "./constants";

const DAY_MS = 86_400_000;

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
}

export function agingBucketFor(
  dueDate: string,
  referenceDate: string,
): { bucket: AgingBucket; overdueDays: number } {
  if (dueDate >= referenceDate) {
    return { bucket: "not_due", overdueDays: 0 };
  }
  const overdueDays = daysBetweenIso(dueDate, referenceDate);
  if (overdueDays <= 30) {
    return { bucket: "d1_30", overdueDays };
  }
  if (overdueDays <= 60) {
    return { bucket: "d31_60", overdueDays };
  }
  if (overdueDays <= 90) {
    return { bucket: "d61_90", overdueDays };
  }
  return { bucket: "d90_plus", overdueDays };
}

export interface AgingInvoiceInput {
  readonly id: string;
  readonly number: string | null;
  readonly customerCode: string;
  readonly customerName: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly totalXof: number;
  readonly paidXof: number;
}

export interface AgedInvoiceRow extends AgingInvoiceInput {
  readonly balanceXof: number;
  readonly overdueDays: number;
  readonly bucket: AgingBucket;
}

export interface AgedReceivables {
  readonly rows: readonly AgedInvoiceRow[];
  readonly totals: Readonly<Record<AgingBucket, number>>;
  readonly totalXof: number;
  readonly overdueXof: number;
}

export function buildAgedReceivables(
  invoices: readonly AgingInvoiceInput[],
  referenceDate: string,
): AgedReceivables {
  const totals: Record<AgingBucket, number> = {
    not_due: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  };
  const rows: AgedInvoiceRow[] = [];
  let totalXof = 0;
  let overdueXof = 0;

  for (const invoice of invoices) {
    const balanceXof = invoice.totalXof - invoice.paidXof;
    if (balanceXof <= 0) {
      continue;
    }
    const { bucket, overdueDays } = agingBucketFor(invoice.dueDate, referenceDate);
    totals[bucket] += balanceXof;
    totalXof += balanceXof;
    if (bucket !== "not_due") {
      overdueXof += balanceXof;
    }
    rows.push({ ...invoice, balanceXof, overdueDays, bucket });
  }

  rows.sort((left, right) => {
    if (left.customerName !== right.customerName) {
      return left.customerName.localeCompare(right.customerName, "fr");
    }
    if (left.dueDate !== right.dueDate) {
      return left.dueDate < right.dueDate ? -1 : 1;
    }
    return (left.number ?? "").localeCompare(right.number ?? "", "fr");
  });

  return { rows, totals, totalXof, overdueXof };
}

export interface IncomeStatementBalance {
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
  readonly debit: number;
  readonly credit: number;
}

export interface IncomeStatementRow {
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
  readonly debit: number;
  readonly credit: number;
  readonly chargeXof: number;
  readonly produitXof: number;
}

export interface IncomeStatement {
  readonly rows: readonly IncomeStatementRow[];
  readonly charges: number;
  readonly produits: number;
  readonly result: number;
  readonly balanceSheetBalance: number;
}

export function buildIncomeStatement(balances: readonly IncomeStatementBalance[]): IncomeStatement {
  const rows: IncomeStatementRow[] = [];
  let charges = 0;
  let produits = 0;
  let balanceSheetBalance = 0;

  for (const balance of balances) {
    const net = balance.debit - balance.credit;
    if (balance.accountClass >= 1 && balance.accountClass <= 5) {
      balanceSheetBalance += balance.credit - balance.debit;
      continue;
    }
    if (net === 0) {
      continue;
    }
    let chargeXof = 0;
    let produitXof = 0;
    if (balance.accountClass === 6) {
      chargeXof = net;
    } else if (balance.accountClass === 7) {
      produitXof = -net;
    } else if (balance.accountClass === 8) {
      if (net > 0) {
        chargeXof = net;
      } else {
        produitXof = -net;
      }
    } else {
      continue;
    }
    charges += chargeXof;
    produits += produitXof;
    rows.push({ ...balance, chargeXof, produitXof });
  }

  return { rows, charges, produits, result: produits - charges, balanceSheetBalance };
}

export interface CommitmentLineInput {
  readonly qty: string;
  readonly receivedQty: string;
  readonly unitPriceXof: number;
}

export interface CommitmentOrderInput {
  readonly id: string;
  readonly number: string | null;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly lines: readonly CommitmentLineInput[];
}

export interface CommitmentRow extends Omit<CommitmentOrderInput, "lines"> {
  readonly lineCount: number;
  readonly amountXof: number;
  readonly overdue: boolean;
}

export interface SupplierCommitments {
  readonly rows: readonly CommitmentRow[];
  readonly totalXof: number;
  readonly overdueXof: number;
}

export function buildSupplierCommitments(
  orders: readonly CommitmentOrderInput[],
  referenceDate: string,
): SupplierCommitments {
  const rows: CommitmentRow[] = [];
  let totalXof = 0;
  let overdueXof = 0;

  for (const order of orders) {
    let lineCount = 0;
    let amountXof = 0;
    for (const line of order.lines) {
      const remainingQty = remainingQuantity(line.qty, line.receivedQty);
      if (remainingQty === "0") {
        continue;
      }
      lineCount += 1;
      amountXof += computeLineTotal(remainingQty, line.unitPriceXof);
    }
    if (lineCount === 0) {
      continue;
    }
    const overdue = order.expectedReceiptDate !== null && order.expectedReceiptDate < referenceDate;
    totalXof += amountXof;
    if (overdue) {
      overdueXof += amountXof;
    }
    rows.push({
      id: order.id,
      number: order.number,
      supplierCode: order.supplierCode,
      supplierName: order.supplierName,
      orderDate: order.orderDate,
      expectedReceiptDate: order.expectedReceiptDate,
      lineCount,
      amountXof,
      overdue,
    });
  }

  rows.sort((left, right) => {
    if (left.supplierName !== right.supplierName) {
      return left.supplierName.localeCompare(right.supplierName, "fr");
    }
    if (left.expectedReceiptDate !== right.expectedReceiptDate) {
      if (left.expectedReceiptDate === null) {
        return 1;
      }
      if (right.expectedReceiptDate === null) {
        return -1;
      }
      return left.expectedReceiptDate < right.expectedReceiptDate ? -1 : 1;
    }
    return (left.number ?? "").localeCompare(right.number ?? "", "fr");
  });

  return { rows, totalXof, overdueXof };
}

export function agingBucketsTotal(totals: Readonly<Record<AgingBucket, number>>): number {
  return AGING_BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0);
}

export interface AgedCustomerTotal {
  readonly customerCode: string;
  readonly customerName: string;
  readonly invoiceCount: number;
  readonly totals: Readonly<Record<AgingBucket, number>>;
  readonly totalXof: number;
}

interface CustomerAggregate {
  customerCode: string;
  customerName: string;
  invoiceCount: number;
  totals: Record<AgingBucket, number>;
  totalXof: number;
}

export function summarizeByCustomer(rows: readonly AgedInvoiceRow[]): readonly AgedCustomerTotal[] {
  const byCustomer = new Map<string, CustomerAggregate>();
  for (const row of rows) {
    const existing = byCustomer.get(row.customerCode);
    const target = existing ?? {
      customerCode: row.customerCode,
      customerName: row.customerName,
      invoiceCount: 0,
      totals: { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
      totalXof: 0,
    };
    target.invoiceCount += 1;
    target.totals[row.bucket] += row.balanceXof;
    target.totalXof += row.balanceXof;
    byCustomer.set(row.customerCode, target);
  }
  return [...byCustomer.values()].sort((left, right) =>
    left.customerName.localeCompare(right.customerName, "fr"),
  );
}
