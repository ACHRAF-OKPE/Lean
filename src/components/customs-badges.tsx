import type { CustomsBondStatus, CustomsDeclarationStatus } from "@/db/schema";
import {
  CUSTOMS_BOND_STATUS_LABELS,
  CUSTOMS_DECLARATION_STATUS_LABELS,
} from "@/modules/customs/constants";

const DECLARATION_CLASSES: Record<CustomsDeclarationStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  deposited: "border-copper/15 bg-copper-soft text-copper",
  liquidated: "border-brand/15 bg-brand-soft text-brand-strong",
  cleared: "border-brand/20 bg-brand text-white",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const BOND_CLASSES: Record<CustomsBondStatus, string> = {
  open: "border-copper/15 bg-copper-soft text-copper",
  apured: "border-brand/15 bg-brand-soft text-brand-strong",
};

export function DeclarationStatusBadge({ status }: { status: CustomsDeclarationStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${DECLARATION_CLASSES[status]}`}
    >
      {CUSTOMS_DECLARATION_STATUS_LABELS[status]}
    </span>
  );
}

export function BondStatusBadge({ status }: { status: CustomsBondStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${BOND_CLASSES[status]}`}
    >
      {CUSTOMS_BOND_STATUS_LABELS[status]}
    </span>
  );
}
