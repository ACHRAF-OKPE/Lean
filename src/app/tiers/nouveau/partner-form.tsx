"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { PartnerCategoryPicker } from "@/components/views/partner-category-picker";
import { createPartnerAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import type { ReferenceOption } from "@/lib/references";

export function PartnerForm({
  categories,
  canCreateCategories,
}: {
  categories: readonly ReferenceOption[];
  canCreateCategories: boolean;
}) {
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
          <h2 className="text-sm font-semibold">Classement</h2>
          <div className="mt-3">
            <PartnerCategoryPicker
              options={categories}
              selected={[]}
              canCreate={canCreateCategories}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Contacts</h2>
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
          <h2 className="text-sm font-semibold">Localisation</h2>
          <p className="mt-2 text-[10px] leading-4 text-muted">
            ART-009 — coordonnées saisies à la main, sans service de géocodage. Les deux valeurs
            vont ensemble : renseignées, le tiers apparaît sur la carte du registre.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Latitude" htmlFor="latitude" hint="Degrés décimaux, de -90 à 90.">
              <input
                id="latitude"
                name="latitude"
                inputMode="decimal"
                placeholder="5.33640"
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label="Longitude" htmlFor="longitude" hint="Degrés décimaux, de -180 à 180.">
              <input
                id="longitude"
                name="longitude"
                inputMode="decimal"
                placeholder="-4.02670"
                className={`${INPUT_CLASS} font-mono`}
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

        <section>
          <h2 className="text-sm font-semibold">Coordonnées de règlement fournisseur</h2>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Facultatif : renseignez uniquement pour un fournisseur. Ces coordonnées sont figées sur
            chaque bon de commande émis à ce tiers.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Banque" htmlFor="bank_name">
              <input
                id="bank_name"
                name="bank_name"
                maxLength={120}
                defaultValue=""
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Pays de la banque"
              htmlFor="bank_country_code"
              hint="Code ISO 3166-1, par exemple CI."
            >
              <input
                id="bank_country_code"
                name="bank_country_code"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                defaultValue=""
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field label="Intitulé du compte" htmlFor="account_holder">
              <input
                id="account_holder"
                name="account_holder"
                maxLength={120}
                defaultValue=""
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Code banque" htmlFor="bank_code">
              <input
                id="bank_code"
                name="bank_code"
                maxLength={20}
                defaultValue=""
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Code guichet" htmlFor="branch_code">
              <input
                id="branch_code"
                name="branch_code"
                maxLength={20}
                defaultValue=""
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Numéro de compte" htmlFor="account_number">
              <input
                id="account_number"
                name="account_number"
                maxLength={34}
                defaultValue=""
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label="Clé RIB" htmlFor="rib_key" hint="Jusqu'à deux chiffres.">
              <input
                id="rib_key"
                name="rib_key"
                maxLength={2}
                defaultValue=""
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label="IBAN" htmlFor="iban" hint="La clé de contrôle est vérifiée.">
              <input
                id="iban"
                name="iban"
                maxLength={34}
                defaultValue=""
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field label="BIC / SWIFT" htmlFor="bic" hint="8 ou 11 caractères, au format BIC.">
              <input
                id="bic"
                name="bic"
                maxLength={11}
                defaultValue=""
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
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
