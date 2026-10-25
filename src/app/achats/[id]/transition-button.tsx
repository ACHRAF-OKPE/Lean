"use client";

import { useActionState } from "react";
import { Archive, BadgeCheck, Ban, LoaderCircle, Send, type LucideIcon } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { transitionPurchaseOrderAction } from "@/lib/purchases/actions";
import { EMPTY_PURCHASE_FORM_STATE } from "@/lib/purchases/form-state";
import type { PurchaseAction } from "@/modules/purchases/lifecycle";

const META: Record<PurchaseAction, { label: string; icon: LucideIcon; className: string }> = {
  request: {
    label: "Demander la validation",
    icon: Send,
    className: "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand",
  },
  confirm: {
    label: "Confirmer la commande",
    icon: BadgeCheck,
    className: "border-transparent bg-brand text-white hover:opacity-90",
  },
  close: {
    label: "Clôturer la commande",
    icon: Archive,
    className: "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand",
  },
  cancel: {
    label: "Annuler la commande",
    icon: Ban,
    className: "border-copper/20 bg-panel text-copper hover:border-copper/40 hover:bg-copper-soft",
  },
};

export function TransitionButton({ orderId, action }: { orderId: string; action: PurchaseAction }) {
  const [state, formAction, pending] = useActionState(
    transitionPurchaseOrderAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const meta = META[action];
  const Icon = meta.icon;

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="action" value={action} />
        <button
          type="submit"
          disabled={pending}
          aria-label={meta.label}
          title={meta.label}
          className={`grid size-9 place-items-center rounded-md border transition-colors disabled:opacity-50 ${meta.className}`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </div>
  );
}
