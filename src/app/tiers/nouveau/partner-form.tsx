"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createPartnerAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";

export function PartnerForm() {
  const [state, formAction, pending] = useActionState(
    createPartnerAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Informations du tiers</legend>

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
                placeholder="CLI001"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field label="Nom" htmlFor="nom" hint="120 caractères maximum.">
              <input
                id="nom"
                name="nom"
                required
                maxLength={120}
                placeholder="Sahel Distribution SARL"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Type" htmlFor="type">
              <select id="type" name="type" defaultValue="Entreprise" className={INPUT_CLASS}>
                <option value="Entreprise">Entreprise</option>
                <option value="Particulier">Particulier</option>
              </select>
            </Field>
            <div className="grid gap-2">
              <CheckboxField
                name="client"
                label="Client"
                hint="Au moins un rôle client ou fournisseur."
                defaultChecked={false}
              />
              <CheckboxField
                name="fournisseur"
                label="Fournisseur"
                hint="Au moins un rôle client ou fournisseur."
                defaultChecked={false}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Coordonnées</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="E-mail" htmlFor="email" hint="Facultatif.">
              <input
                id="email"
                name="email"
                type="email"
                maxLength={160}
                autoComplete="off"
                placeholder="contact@exemple.com"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Téléphone" htmlFor="telephone" hint="30 caractères maximum.">
              <input
                id="telephone"
                name="telephone"
                maxLength={30}
                placeholder="+225 27 00 00 00 00"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Adresse" htmlFor="adresse" hint="200 caractères maximum.">
              <input
                id="adresse"
                name="adresse"
                maxLength={200}
                placeholder="Zone industrielle"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Ville" htmlFor="ville" hint="80 caractères maximum.">
              <input
                id="ville"
                name="ville"
                maxLength={80}
                placeholder="Abidjan"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Pays"
              htmlFor="pays"
              hint="Code ISO 3166-1 à deux lettres, par exemple CI."
            >
              <input
                id="pays"
                name="pays"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="CI"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Conditions</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Numéro fiscal" htmlFor="numero_fiscal" hint="40 caractères maximum.">
              <input
                id="numero_fiscal"
                name="numero_fiscal"
                maxLength={40}
                placeholder="CI123456789"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Délai de paiement (jours)"
              htmlFor="delai_paiement_jours"
              hint="Entier de 0 à 365."
            >
              <input
                id="delai_paiement_jours"
                name="delai_paiement_jours"
                type="number"
                min={0}
                max={365}
                step={1}
                defaultValue={0}
                className={INPUT_CLASS}
              />
            </Field>
            <CheckboxField name="actif" label="Actif" hint="Un tiers inactif reste visible." />
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href="/tiers"
          aria-label="Annuler et revenir aux tiers"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer le tiers"
          title="Enregistrer le tiers"
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
