import {
  compareQuantity,
  computeLineTotal,
  isZeroQuantity,
  subtractQuantity,
} from "@/modules/stock/quantities";
import { formatXof } from "@/lib/money";

export type PurchaseOrderMatchingStatus =
  "unmatched" | "matched" | "quantity_mismatch" | "price_mismatch" | "pending_receipt" | "disputed";

export type LineMatchingStatus =
  "matched" | "quantity_mismatch" | "price_mismatch" | "pending_receipt" | "disputed";

export interface OrderLineForMatching {
  readonly orderLineId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly type: "product" | "service";
  readonly orderedQty: string;
  readonly orderedUnitPriceXof: number;
  readonly receivedQty: string;
}

export interface InvoicedLineInput {
  readonly orderLineId: string;
  readonly invoicedQty: string;
  readonly invoicedUnitPriceXof: number;
}

export interface InvoiceMatchingInput {
  readonly supplierInvoiceNumber: string;
  readonly supplierInvoiceDate: string;
  readonly supplierInvoiceAmountXof?: number | null;
  readonly lines: readonly InvoicedLineInput[];
}

export interface LineMatchingResult {
  readonly orderLineId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly type: "product" | "service";
  readonly orderedQty: string;
  readonly receivedQty: string;
  readonly invoicedQty: string;
  readonly orderedUnitPriceXof: number;
  readonly invoicedUnitPriceXof: number;
  readonly orderedTotalXof: number;
  readonly receivedTotalXof: number;
  readonly invoicedTotalXof: number;
  readonly qtyDifference: string;
  readonly unitPriceDifferenceXof: number;
  readonly amountDifferenceXof: number;
  readonly status: LineMatchingStatus;
}

export interface ThreeWayMatchingResult {
  readonly status: PurchaseOrderMatchingStatus;
  readonly isApprovedForPayment: boolean;
  readonly supplierInvoiceNumber: string;
  readonly supplierInvoiceDate: string;
  readonly totalOrderedXof: number;
  readonly totalReceivedXof: number;
  readonly totalInvoicedXof: number;
  readonly netDiscrepancyXof: number;
  readonly summaryNotice: string;
  readonly lines: readonly LineMatchingResult[];
}

export function matchingStatusLabel(status: PurchaseOrderMatchingStatus): string {
  switch (status) {
    case "unmatched":
      return "Non rapproché";
    case "matched":
      return "Conforme — Bon à payer";
    case "quantity_mismatch":
      return "Écart de quantité";
    case "price_mismatch":
      return "Écart de prix";
    case "pending_receipt":
      return "En attente de réception";
    case "disputed":
      return "En litige";
  }
}

export function lineMatchingStatusLabel(status: LineMatchingStatus): string {
  switch (status) {
    case "matched":
      return "Conforme";
    case "quantity_mismatch":
      return "Surfacturation quantité";
    case "price_mismatch":
      return "Surcoût tarifaire";
    case "pending_receipt":
      return "Non reçu";
    case "disputed":
      return "Litige";
  }
}

/**
 * PUR-016 : Calcule le rapprochement tripartite (3-Way Match) entre :
 * 1. Bon de commande (quantités et prix convenus)
 * 2. Réceptions réelles en magasin (quantités constatées)
 * 3. Facture fournisseur (quantités et prix réclamés)
 */
export function computeThreeWayMatching(
  orderLines: readonly OrderLineForMatching[],
  invoice: InvoiceMatchingInput,
): ThreeWayMatchingResult {
  const invoiceLineMap = new Map<string, InvoicedLineInput>();
  for (const line of invoice.lines) {
    invoiceLineMap.set(line.orderLineId, line);
  }

  let totalOrderedXof = 0;
  let totalReceivedXof = 0;
  let totalInvoicedXof = 0;

  const lines: LineMatchingResult[] = orderLines.map((orderLine) => {
    const invoiced = invoiceLineMap.get(orderLine.orderLineId);
    const invoicedQty = invoiced ? invoiced.invoicedQty : "0";
    const invoicedUnitPriceXof = invoiced
      ? invoiced.invoicedUnitPriceXof
      : orderLine.orderedUnitPriceXof;

    const orderedTotalXof = computeLineTotal(orderLine.orderedQty, orderLine.orderedUnitPriceXof);
    const receivedTotalXof = computeLineTotal(orderLine.receivedQty, orderLine.orderedUnitPriceXof);
    const invoicedTotalXof = computeLineTotal(invoicedQty, invoicedUnitPriceXof);

    totalOrderedXof += orderedTotalXof;
    totalReceivedXof += receivedTotalXof;
    totalInvoicedXof += invoicedTotalXof;

    // Pour un service, la réception est réputée conforme si <= commande
    const effectiveReceivedQty =
      orderLine.type === "service" ? orderLine.orderedQty : orderLine.receivedQty;

    const qtyDiff = subtractQuantity(invoicedQty, effectiveReceivedQty);
    const isQtyExcess = compareQuantity(invoicedQty, effectiveReceivedQty) > 0;
    const isPriceExcess = invoicedUnitPriceXof > orderLine.orderedUnitPriceXof;
    const isPendingReception =
      orderLine.type === "product" &&
      isZeroQuantity(orderLine.receivedQty) &&
      !isZeroQuantity(invoicedQty);

    let status: LineMatchingStatus = "matched";
    if (isPendingReception) {
      status = "pending_receipt";
    } else if (isQtyExcess && isPriceExcess) {
      status = "disputed";
    } else if (isQtyExcess) {
      status = "quantity_mismatch";
    } else if (isPriceExcess) {
      status = "price_mismatch";
    } else {
      status = "matched";
    }

    return {
      orderLineId: orderLine.orderLineId,
      name: orderLine.name,
      unitCode: orderLine.unitCode,
      type: orderLine.type,
      orderedQty: orderLine.orderedQty,
      receivedQty: orderLine.receivedQty,
      invoicedQty,
      orderedUnitPriceXof: orderLine.orderedUnitPriceXof,
      invoicedUnitPriceXof,
      orderedTotalXof,
      receivedTotalXof,
      invoicedTotalXof,
      qtyDifference: qtyDiff,
      unitPriceDifferenceXof: invoicedUnitPriceXof - orderLine.orderedUnitPriceXof,
      amountDifferenceXof: invoicedTotalXof - receivedTotalXof,
      status,
    };
  });

  const netDiscrepancyXof = totalInvoicedXof - totalReceivedXof;

  // Détermination du statut global
  let globalStatus: PurchaseOrderMatchingStatus = "matched";
  if (lines.length === 0) {
    globalStatus = "unmatched";
  } else if (lines.some((l) => l.status === "disputed")) {
    globalStatus = "disputed";
  } else if (lines.some((l) => l.status === "quantity_mismatch")) {
    globalStatus = "quantity_mismatch";
  } else if (lines.some((l) => l.status === "price_mismatch")) {
    globalStatus = "price_mismatch";
  } else if (lines.every((l) => l.status === "pending_receipt")) {
    globalStatus = "pending_receipt";
  } else if (lines.some((l) => l.status === "pending_receipt")) {
    globalStatus = "quantity_mismatch";
  } else {
    globalStatus = "matched";
  }

  const isApprovedForPayment = globalStatus === "matched";

  let summaryNotice: string;
  switch (globalStatus) {
    case "matched":
      summaryNotice = `Rapprochement tripartite 100 % conforme. Facture N° ${invoice.supplierInvoiceNumber} validée pour un montant de ${formatXof(totalInvoicedXof)}. Bon à payer certifié.`;
      break;
    case "quantity_mismatch":
      summaryNotice = `Écart de quantité sur la facture N° ${invoice.supplierInvoiceNumber} : surfacturation par rapport aux réceptions physiques. Écart net de ${formatXof(netDiscrepancyXof)}. Paiement bloqué.`;
      break;
    case "price_mismatch":
      summaryNotice = `Écart de prix sur la facture N° ${invoice.supplierInvoiceNumber} : dépassement tarifaire par rapport au bon de commande validé. Surcoût de ${formatXof(netDiscrepancyXof)}. Paiement bloqué.`;
      break;
    case "pending_receipt":
      summaryNotice = `Facture N° ${invoice.supplierInvoiceNumber} enregistrée, mais aucune réception physique n'a encore été enregistrée en magasin. Paiement suspendu.`;
      break;
    case "disputed":
      summaryNotice = `Litige sur la facture N° ${invoice.supplierInvoiceNumber} : divergences cumulées sur les quantités et les prix convenus. Paiement bloqué.`;
      break;
    case "unmatched":
      summaryNotice = "Aucune facture fournisseur rapprochée pour cette commande.";
      break;
  }

  return {
    status: globalStatus,
    isApprovedForPayment,
    supplierInvoiceNumber: invoice.supplierInvoiceNumber,
    supplierInvoiceDate: invoice.supplierInvoiceDate,
    totalOrderedXof,
    totalReceivedXof,
    totalInvoicedXof,
    netDiscrepancyXof,
    summaryNotice,
    lines,
  };
}
