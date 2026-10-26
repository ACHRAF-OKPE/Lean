import type {
  DeliveryState,
  DeliveryStatus,
  InvoiceStatus,
  InvoicingState,
  SalesOrderStatus,
} from "@/db/schema";
import {
  deliveryStateLabel,
  invoicingStateLabel,
  salesStatusLabel,
} from "@/modules/sales/lifecycle";

const ORDER_CLASSES: Record<SalesOrderStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  confirmed: "border-brand/15 bg-brand-soft text-brand-strong",
  closed: "border-line bg-panel text-muted",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const DELIVERY_CLASSES: Record<DeliveryState, string> = {
  not_delivered: "border-line bg-canvas text-muted",
  partially_delivered: "border-copper/15 bg-copper-soft text-copper",
  delivered: "border-brand/15 bg-brand-soft text-brand-strong",
};

const INVOICING_CLASSES: Record<InvoicingState, string> = {
  not_invoiced: "border-line bg-canvas text-muted",
  partially_invoiced: "border-copper/15 bg-copper-soft text-copper",
  invoiced: "border-brand/15 bg-brand-soft text-brand-strong",
};

const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Brouillon",
  validated: "Validée",
  cancelled: "Annulée",
};

const INVOICE_STATUS_CLASSES: Record<InvoiceStatus, string> = {
  draft: "border-copper/15 bg-copper-soft text-copper",
  validated: "border-brand/15 bg-brand-soft text-brand-strong",
  cancelled: "border-line bg-canvas text-muted",
};

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  validated: "Validée",
  cancelled: "Annulée",
};

const DELIVERY_STATUS_CLASSES: Record<DeliveryStatus, string> = {
  validated: "border-brand/15 bg-brand-soft text-brand-strong",
  cancelled: "border-line bg-canvas text-muted",
};

export function SalesStatusBadge({ status }: { status: SalesOrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${ORDER_CLASSES[status]}`}
    >
      {salesStatusLabel(status)}
    </span>
  );
}

export function DeliveryStateBadge({ state }: { state: DeliveryState }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${DELIVERY_CLASSES[state]}`}
    >
      {deliveryStateLabel(state)}
    </span>
  );
}

export function InvoicingStateBadge({ state }: { state: InvoicingState }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${INVOICING_CLASSES[state]}`}
    >
      {invoicingStateLabel(state)}
    </span>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${INVOICE_STATUS_CLASSES[status]}`}
    >
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${DELIVERY_STATUS_CLASSES[status]}`}
    >
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}
