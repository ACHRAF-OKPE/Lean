"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createHsCodeAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import { TEC_RATES } from "@/modules/customs/constants";

export function HsCodeForm() {
  const [state, formAction, pending] = useActionState(createHsCodeAction, EMPTY_CATALOG_FORM_STATE);

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Informations du code SH</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Code SH" htmlFor="code" hint="6, 8 ou 10 chiffres, par exemple 0901110000.">
            <input
              id="code"
              name="code"
              required
              inputMode="numeric"
              maxLength={10}
              pattern="\d{6}(\d{2}(\d{2})?)?"
              autoFocus
              placeholder="0901110000"
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>
          <Field label="Libellé" htmlFor="libelle" hint="240 caractères maximum.">
            <input
              id="libelle"
              name="libelle"
              required
              maxLength={240}
              placeholder="Café non torréfié, non décaféiné"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Code parent"
            htmlFor="code_parent"
            hint="Facultatif. Préfixe strict du code, déjà présent ou importé dans le même fichier."
          >
            <input
              id="code_parent"
              name="code_parent"
              inputMode="numeric"
              maxLength={8}
              pattern="\d{6}(\d{2})?"
              placeholder="09011100"
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
              placeholder="KG"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Taux TEC"
            htmlFor="taux_tec"
            hint="Bande UEMOA. Obligatoire pour liquider une déclaration."
          >
            <select id="taux_tec" name="taux_tec" defaultValue="" className={INPUT_CLASS}>
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
          href="/nomenclature"
          aria-label="Annuler et revenir à la nomenclature"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer le code SH"
          title="Enregistrer le code SH"
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
