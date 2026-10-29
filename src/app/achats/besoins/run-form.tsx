"use client";

import { useActionState } from "react";
import { Calculator, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { runCalculationAction } from "@/lib/supply/actions";
import { EMPTY_SUPPLY_FORM_STATE } from "@/lib/supply/form-state";

export function RunCalculationForm({ hasPolicies }: { hasPolicies: boolean }) {
  const [state, formAction, pending] = useActionState(
    runCalculationAction,
    EMPTY_SUPPLY_FORM_STATE,
  );

  return (
    <form action={formAction} className="rounded-xl border border-line bg-panel px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label="Horizon (jours)" htmlFor="supply-horizon" hint="Entre 1 et 365 jours.">
            <input
              id="supply-horizon"
              name="horizonDays"
              type="number"
              min={1}
              max={365}
              step={1}
              defaultValue={30}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={pending || !hasPolicies}
          aria-label="Lancer le calcul des besoins"
          title="Lancer le calcul"
          className="grid size-9 place-items-center rounded-md border border-transparent bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Calculator className="size-4" aria-hidden="true" />
          )}
        </button>
        <p className="max-w-md text-[10px] leading-4 text-muted">
          {hasPolicies
            ? "Le calcul confronte le stock interne, les commandes fournisseurs confirmées non reçues et les commandes clients confirmées non livrées. Chaque calcul est numéroté et figé."
            : "Définissez d'abord une politique d'approvisionnement active : le calcul n'a aucun article à analyser."}
        </p>
      </div>
      <div className="mt-3">
        <FormErrors errors={state.errors} />
      </div>
    </form>
  );
}
