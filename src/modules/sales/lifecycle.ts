import type { DeliveryState, InvoicingState, SalesOrderStatus } from "@/db/schema";
import { compareQuantity, isZeroQuantity } from "@/modules/stock/quantities";

export type SalesAction = "confirm" | "close" | "cancel";

const ALLOWED_STATUSES: Record<SalesAction, readonly SalesOrderStatus[]> = {
  confirm: ["draft"],
  close: ["confirmed"],
  cancel: ["draft", "confirmed"],
};

export const SALES_TRANSITION_TARGET: Record<Exclude<SalesAction, "cancel">, SalesOrderStatus> = {
  confirm: "confirmed",
  close: "closed",
};

export function canApplySalesAction(status: SalesOrderStatus, action: SalesAction): boolean {
  return ALLOWED_STATUSES[action].includes(status);
}

export function salesActionLabel(action: SalesAction): string {
  switch (action) {
    case "confirm":
      return "confirmer";
    case "close":
      return "clôturer";
    case "cancel":
      return "annuler";
  }
}

export function salesStatusLabel(status: SalesOrderStatus): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "confirmed":
      return "Confirmée";
    case "closed":
      return "Clôturée";
    case "cancelled":
      return "Annulée";
  }
}

export function deliveryStateLabel(state: DeliveryState): string {
  switch (state) {
    case "not_delivered":
      return "Non livrée";
    case "partially_delivered":
      return "Partiellement livrée";
    case "delivered":
      return "Livrée";
  }
}

export function invoicingStateLabel(state: InvoicingState): string {
  switch (state) {
    case "not_invoiced":
      return "Non facturée";
    case "partially_invoiced":
      return "Partiellement facturée";
    case "invoiced":
      return "Facturée";
  }
}

export function computeLineDeliveryState(qty: string, deliveredQty: string): DeliveryState {
  if (isZeroQuantity(deliveredQty)) {
    return "not_delivered";
  }
  return compareQuantity(deliveredQty, qty) >= 0 ? "delivered" : "partially_delivered";
}

export function computeOrderDeliveryState(
  lines: readonly {
    readonly type: "product" | "service";
    readonly deliveryState: DeliveryState;
  }[],
): DeliveryState {
  const stockLines = lines.filter((line) => line.type === "product");
  if (stockLines.length === 0) {
    return "delivered";
  }
  if (stockLines.every((line) => line.deliveryState === "delivered")) {
    return "delivered";
  }
  if (stockLines.every((line) => line.deliveryState === "not_delivered")) {
    return "not_delivered";
  }
  return "partially_delivered";
}

export function computeLineInvoicingState(qty: string, invoicedQty: string): InvoicingState {
  if (isZeroQuantity(invoicedQty)) {
    return "not_invoiced";
  }
  return compareQuantity(invoicedQty, qty) >= 0 ? "invoiced" : "partially_invoiced";
}

export function computeOrderInvoicingState(
  lines: readonly { readonly invoicingState: InvoicingState }[],
): InvoicingState {
  if (lines.length === 0) {
    return "not_invoiced";
  }
  if (lines.every((line) => line.invoicingState === "invoiced")) {
    return "invoiced";
  }
  if (lines.every((line) => line.invoicingState === "not_invoiced")) {
    return "not_invoiced";
  }
  return "partially_invoiced";
}

export function canDeliver(status: SalesOrderStatus): boolean {
  return status === "confirmed";
}

export function canInvoice(status: SalesOrderStatus): boolean {
  return status === "confirmed";
}
