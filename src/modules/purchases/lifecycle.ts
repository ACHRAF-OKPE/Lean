import type { PurchaseOrderStatus, ReceiptState } from "@/db/schema";
import { compareQuantity, isZeroQuantity } from "@/modules/stock/quantities";

export type PurchaseAction = "request" | "confirm" | "close" | "cancel";

const ALLOWED_STATUSES: Record<PurchaseAction, readonly PurchaseOrderStatus[]> = {
  request: ["draft"],
  confirm: ["requested"],
  close: ["confirmed"],
  cancel: ["draft", "requested", "confirmed"],
};

export const PURCHASE_TRANSITION_TARGET: Record<
  Exclude<PurchaseAction, "cancel">,
  PurchaseOrderStatus
> = {
  request: "requested",
  confirm: "confirmed",
  close: "closed",
};

export function canApplyAction(status: PurchaseOrderStatus, action: PurchaseAction): boolean {
  return ALLOWED_STATUSES[action].includes(status);
}

export function actionLabel(action: PurchaseAction): string {
  switch (action) {
    case "request":
      return "demander la validation";
    case "confirm":
      return "valider";
    case "close":
      return "clôturer";
    case "cancel":
      return "annuler";
  }
}

export function statusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "requested":
      return "Demandée";
    case "confirmed":
      return "Confirmée";
    case "closed":
      return "Clôturée";
    case "cancelled":
      return "Annulée";
  }
}

export function receiptStateLabel(state: ReceiptState): string {
  switch (state) {
    case "not_received":
      return "Non reçue";
    case "partially_received":
      return "Partiellement reçue";
    case "received":
      return "Reçue";
  }
}

export function computeLineReceiptState(qty: string, receivedQty: string): ReceiptState {
  if (isZeroQuantity(receivedQty)) {
    return "not_received";
  }
  return compareQuantity(receivedQty, qty) >= 0 ? "received" : "partially_received";
}

export function computeOrderReceiptState(
  lines: readonly { readonly type: "product" | "service"; readonly receiptState: ReceiptState }[],
): ReceiptState {
  const stockLines = lines.filter((line) => line.type === "product");
  if (stockLines.length === 0) {
    return "received";
  }
  if (stockLines.every((line) => line.receiptState === "received")) {
    return "received";
  }
  if (stockLines.every((line) => line.receiptState === "not_received")) {
    return "not_received";
  }
  return "partially_received";
}
