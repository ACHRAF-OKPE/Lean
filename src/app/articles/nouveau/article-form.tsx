"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createArticleAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import { MAX_XOF_AMOUNT, UNITS } from "@/modules/catalog/constants";

export function ArticleForm() {
  const [state, formAction, pending] = useActionState(
    createArticleAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Informations de l&apos;article</legend>

        <section>
          <h2 className="text-sm font-semibold">Identification</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="Code"
              htmlFor="code"
              hint="32 caractères max : lettres, chiffres, point, tiret, barre oblique, souligné."
            >
              <input
                id="code"
                name="code"
                required
                maxLength={32}
                autoFocus
                placeholder="ART001"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field label="Désignation" htmlFor="designation" hint="160 caractères maximum.">
              <input
                id="designation"
                name="designation"
                required
                maxLength={160}
                placeholder="Café vert en sacs de 60 kg"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Type" htmlFor="type">
              <select id="type" name="type" defaultValue="Produit" className={INPUT_CLASS}>
                <option value="Produit">Produit</option>
                <option value="Service">Service</option>
              </select>
            </Field>
            <Field
              label="Description"
              htmlFor="description"
              hint="1000 caractères maximum, facultatif."
            >
              <textarea
                id="description"
                name="description"
                maxLength={1000}
                rows={3}
                placeholder="Arabica non torréfié"
                className={`${INPUT_CLASS} min-h-24 resize-y`}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Classification</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Unité" htmlFor="unite">
              <select id="unite" name="unite" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>
                  Choisir une unité…
                </option>
                {UNITS.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code} — {unit.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Code SH"
              htmlFor="code_sh"
              hint="6, 8 ou 10 chiffres ; obligatoire pour un produit et déjà présent dans la nomenclature."
            >
              <input
                id="code_sh"
                name="code_sh"
                inputMode="numeric"
                maxLength={10}
                pattern="\d{6}(\d{2}(\d{2})?)?"
                placeholder="0901110000"
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field
              label="Pays d'origine"
              htmlFor="pays_origine"
              hint="Code ISO 3166-1 à deux lettres, facultatif."
            >
              <input
                id="pays_origine"
                name="pays_origine"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="CI"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Prix et usages</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="Prix de vente (XOF)"
              htmlFor="prix_vente_xof"
              hint="Montant entier, sans décimale."
            >
              <input
                id="prix_vente_xof"
                name="prix_vente_xof"
                type="number"
                min={0}
                max={MAX_XOF_AMOUNT}
                step={1}
                defaultValue={0}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Prix d'achat (XOF)"
              htmlFor="prix_achat_xof"
              hint="Montant entier, sans décimale."
            >
              <input
                id="prix_achat_xof"
                name="prix_achat_xof"
                type="number"
                min={0}
                max={MAX_XOF_AMOUNT}
                step={1}
                defaultValue={0}
                className={INPUT_CLASS}
              />
            </Field>
            <div className="grid gap-2">
              <CheckboxField
                name="vendable"
                label="Vendable"
                hint="Au moins un usage vente ou achat."
              />
              <CheckboxField
                name="achetable"
                label="Achetable"
                hint="Au moins un usage vente ou achat."
              />
              <CheckboxField name="actif" label="Actif" hint="Un article inactif reste visible." />
            </div>
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href="/articles"
          aria-label="Annuler et revenir aux articles"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer l'article"
          title="Enregistrer l'article"
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
