"use client";

import { useActionState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { saveSalesSettingsAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";

export function SalesSettingsForm({
  values,
}: {
  values: { readonly defaultDeliveryDelayDays: number } | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveSalesSettingsAction,
    EMPTY_SALES_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage des ventes</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Délai de livraison par défaut"
            htmlFor="settings-delivery-delay"
            hint="Jours ajoutés à la date du jour pour proposer la livraison prévue, entre 0 et 365. Zéro : aucune proposition."
          >
            <input
              id="settings-delivery-delay"
              name="defaultDeliveryDelayDays"
              type="number"
              min={0}
              max={365}
              step={1}
              inputMode="numeric"
              defaultValue={values?.defaultDeliveryDelayDays ?? 0}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le paramétrage des ventes"
            title="Enregistrer"
            className={SUBMIT}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
