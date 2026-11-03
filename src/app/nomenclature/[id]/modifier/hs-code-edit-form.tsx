"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { updateHsCodeAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import { TEC_RATES } from "@/modules/customs/constants";

export interface HsCodeEditDefaults {
  readonly id: string;
  readonly code: string;
  readonly wording: string;
  readonly parentCode: string | null;
  readonly supplementaryUnit: string | null;
  readonly tecRate: number | null;
}

/** ART-022 — la fiche se corrige ligne à ligne ; le code reste l'identifiant figé de la fiche. */
export function HsCodeEditForm({ hsCode }: { hsCode: HsCodeEditDefaults }) {
  const [state, formAction, pending] = useActionState(updateHsCodeAction, EMPTY_CATALOG_FORM_STATE);

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="hsCodeId" value={hsCode.id} />
      <input type="hidden" name="code" value={hsCode.code} />
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Informations du code SH</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Code SH" htmlFor="code" hint="Immuable : il identifie la fiche et l'audit.">
            <input
              id="code"
              defaultValue={hsCode.code}
              disabled
              className={`${INPUT_CLASS} font-mono opacity-60`}
            />
          </Field>
          <Field label="Libellé" htmlFor="libelle" hint="240 caractères maximum.">
            <input
              id="libelle"
              name="libelle"
              required
              maxLength={240}
              autoFocus
              defaultValue={hsCode.wording}
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Code parent"
            htmlFor="code_parent"
            hint="Facultatif : préfixe strict du code (6 ou 8 chiffres). Vide, le code n'a pas de parent."
          >
            <input
              id="code_parent"
              name="code_parent"
              inputMode="numeric"
              maxLength={8}
              pattern="\d{6}(\d{2})?"
              defaultValue={hsCode.parentCode ?? ""}
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>
          <Field
            label="Unité complémentaire"
            htmlFor="unite_complementaire"
            hint="30 caractères maximum, facultatif."
          >
            <input
              id="unite_complementaire"
              name="unite_complementaire"
              maxLength={30}
              defaultValue={hsCode.supplementaryUnit ?? ""}
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Taux TEC"
            htmlFor="taux_tec"
            hint="Bande UEMOA. Obligatoire pour liquider une déclaration."
          >
            <select
              id="taux_tec"
              name="taux_tec"
              defaultValue={hsCode.tecRate === null ? "" : String(hsCode.tecRate)}
              className={INPUT_CLASS}
            >
              <option value="">Non renseigné</option>
              {TEC_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} %
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href={`/nomenclature/${hsCode.id}`}
          aria-label="Annuler et revenir à la fiche"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer les modifications"
          title="Enregistrer les modifications"
          className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
