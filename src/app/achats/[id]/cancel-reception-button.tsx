"use client";

import { useActionState } from "react";
import { LoaderCircle, Undo2 } from "lucide-react";
import { cancelReceptionAction } from "@/lib/purchases/actions";
import { EMPTY_PURCHASE_FORM_STATE } from "@/lib/purchases/form-state";

export function CancelReceptionButton({
  orderId,
  receptionId,
  number,
}: {
  orderId: string;
  receptionId: string;
  number: string;
}) {
  const [state, formAction, pending] = useActionState(
    cancelReceptionAction,
    EMPTY_PURCHASE_FORM_STATE,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="receptionId" value={receptionId} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`Annuler la réception ${number}`}
          title="Annuler la réception"
          className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/40 hover:text-copper disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Undo2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.map((error) => (
        <p
          key={error}
          role="alert"
          className="max-w-48 text-right text-[9px] leading-3 text-red-700"
        >
          {error}
        </p>
      ))}
    </div>
  );
}
