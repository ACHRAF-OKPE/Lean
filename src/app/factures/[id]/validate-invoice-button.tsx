"use client";

import { useActionState } from "react";
import { BadgeCheck, LoaderCircle } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { validateInvoiceAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";

export function ValidateInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(
    validateInvoiceAction,
    EMPTY_SALES_FORM_STATE,
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <button
          type="submit"
          disabled={pending}
          aria-label="Valider la facture"
          title="Valider la facture"
          className="grid size-9 place-items-center rounded-md border border-transparent bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <BadgeCheck className="size-4" aria-hidden="true" />
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
