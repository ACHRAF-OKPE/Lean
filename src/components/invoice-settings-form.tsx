"use client";

import { useActionState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { saveInvoiceSettingsAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";

export function InvoiceSettingsForm({ dueDateOffsetDays }: { dueDateOffsetDays: number }) {
  const [state, formAction, pending] = useActionState(
    saveInvoiceSettingsAction,
    EMPTY_SALES_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage des factures</legend>
        <Field
          label="Délai d'échéance par défaut"
          htmlFor="settings-invoice-due-offset"
          hint="Jours ajoutés à la date de facture pour proposer l'échéance, entre 0 et 365."
        >
          <input
            id="settings-invoice-due-offset"
            name="dueDateOffsetDays"
            type="number"
            min={0}
            max={365}
            step={1}
            inputMode="numeric"
            required
            defaultValue={dueDateOffsetDays}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </Field>
        <button
          type="submit"
          aria-label="Enregistrer le paramétrage des factures"
          title="Enregistrer le paramétrage des factures"
          className={SUBMIT}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
        </button>
      </fieldset>
    </form>
  );
}
