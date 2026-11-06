"use client";

import { useActionState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { saveTenderSettingsAction } from "@/lib/tenders/actions";
import { EMPTY_TENDER_FORM_STATE } from "@/lib/tenders/form-state";
import { DEFAULT_TENDER_DEADLINE_DAYS } from "@/modules/tenders/settings";

export function TenderSettingsForm({ defaultDeadlineDays }: { defaultDeadlineDays: number }) {
  const [state, formAction, pending] = useActionState(
    saveTenderSettingsAction,
    EMPTY_TENDER_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage des appels d&apos;offres</legend>
        <Field
          label="Délai de réponse par défaut"
          htmlFor="settings-tender-deadline-days"
          hint={`Jours ajoutés à la date du jour, entre 1 et 365. Valeur suggérée : ${DEFAULT_TENDER_DEADLINE_DAYS} jours.`}
        >
          <input
            id="settings-tender-deadline-days"
            name="defaultDeadlineDays"
            type="number"
            min={1}
            max={365}
            step={1}
            inputMode="numeric"
            required
            defaultValue={defaultDeadlineDays}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </Field>
        <button
          type="submit"
          aria-label="Enregistrer le paramétrage des appels d'offres"
          title="Enregistrer le paramétrage des appels d'offres"
          className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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
