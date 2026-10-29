import type { TenderInvitationStatus, TenderStatus } from "@/db/schema";
import { INVITATION_STATUS_LABELS, TENDER_STATUS_LABELS } from "@/modules/tenders/rules";

const TENDER_CLASSES: Record<TenderStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  open: "border-brand/15 bg-brand-soft text-brand-strong",
  awarded: "border-copper/15 bg-copper-soft text-copper",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const INVITATION_CLASSES: Record<TenderInvitationStatus, string> = {
  pending: "border-line bg-canvas text-muted",
  sent: "border-brand/15 bg-brand-soft text-brand-strong",
  quoted: "border-copper/15 bg-copper-soft text-copper",
  declined: "border-red-200 bg-red-50 text-red-700",
};

export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${TENDER_CLASSES[status]}`}
    >
      {TENDER_STATUS_LABELS[status]}
    </span>
  );
}

export function TenderInvitationStatusBadge({ status }: { status: TenderInvitationStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${INVITATION_CLASSES[status]}`}
    >
      {INVITATION_STATUS_LABELS[status]}
    </span>
  );
}
