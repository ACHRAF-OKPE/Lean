import type { PurchaseOrderStatus, ReceiptState } from "@/db/schema";
import { receiptStateLabel, statusLabel } from "@/modules/purchases/lifecycle";

const ORDER_STATUS_CLASSES: Record<PurchaseOrderStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  requested: "border-copper/15 bg-copper-soft text-copper",
  confirmed: "border-brand/15 bg-brand-soft text-brand-strong",
  closed: "border-line bg-panel text-muted",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const RECEIPT_CLASSES: Record<ReceiptState, string> = {
  not_received: "border-line bg-canvas text-muted",
  partially_received: "border-copper/15 bg-copper-soft text-copper",
  received: "border-brand/15 bg-brand-soft text-brand-strong",
};

export function PurchaseStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${ORDER_STATUS_CLASSES[status]}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ReceiptStateBadge({ state }: { state: ReceiptState }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${RECEIPT_CLASSES[state]}`}
    >
      {receiptStateLabel(state)}
    </span>
  );
}
