import type { ExchangeMessageStatus, ExchangeType } from "@/db/schema";
import { EXCHANGE_TYPE_LABELS } from "@/modules/exchange/templates";

const STATUS_META: Record<ExchangeMessageStatus, { label: string; className: string }> = {
  sent: { label: "Envoyé", className: "border-brand/15 bg-brand-soft text-brand-strong" },
  failed: { label: "Échec", className: "border-copper/20 bg-copper-soft text-copper" },
};

export function ExchangeStatusBadge({ status }: { status: ExchangeMessageStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function ExchangeTypeBadge({ type }: { type: ExchangeType }) {
  return (
    <span className="inline-flex rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] whitespace-nowrap text-muted">
      {EXCHANGE_TYPE_LABELS[type]}
    </span>
  );
}
