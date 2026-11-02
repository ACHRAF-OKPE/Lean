"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { PartnerCategoryPicker } from "@/components/views/partner-category-picker";
import { updatePartnerAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import type { ReferenceOption } from "@/lib/references";
import { MAX_PAYMENT_TERM_DAYS } from "@/modules/catalog/constants";

export interface PartnerEditDefaults {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isCompany: boolean;
  readonly isCustomer: boolean;
  readonly isSupplier: boolean;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly taxNumber: string | null;
  readonly paymentTermDays: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly active: boolean;
}

/** GEN-013 — la correction se fait sur des lignes soulignées ; le code reste l'identifiant figé de la fiche. */
export function PartnerEditForm({
  partner,
  categories,
  selected,
  canCreateCategories,
}: {
  partner: PartnerEditDefaults;
  categories: readonly ReferenceOption[];
  selected: readonly string[];
  canCreateCategories: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updatePartnerAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="partnerId" value={partner.id} />
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Informations du tiers</legend>

        <section>
          <h2 className="text-sm font-semibold">Identification</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Code" htmlFor="code" hint="Immuable : il identifie la fiche et l'audit.">
              <input
                id="code"
                defaultValue={partner.code}
                disabled
                className={`${INPUT_CLASS} font-mono uppercase opacity-60`}
              />
            </Field>
            <Field label="Nom" htmlFor="nom" hint="120 caractères maximum.">
              <input
                id="nom"
                name="nom"
                required
                maxLength={120}
                autoFocus
                defaultValue={partner.name}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Type" htmlFor="type">
              <select
                id="type"
                name="type"
                defaultValue={partner.isCompany ? "Entreprise" : "Particulier"}
                className={INPUT_CLASS}
              >
                <option value="Entreprise">Entreprise</option>
                <option value="Particulier">Particulier</option>
              </select>
            </Field>
            <div className="grid gap-2">
              <CheckboxField
                name="client"
                label="Client"
                hint="Au moins un rôle client ou fournisseur."
                defaultChecked={partner.isCustomer}
              />
              <CheckboxField
                name="fournisseur"
                label="Fournisseur"
                hint="Au moins un rôle client ou fournisseur."
                defaultChecked={partner.isSupplier}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Classement</h2>
          <div className="mt-3">
            <PartnerCategoryPicker
              options={categories}
              selected={selected}
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
                defaultValue={partner.email ?? ""}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Téléphone" htmlFor="telephone" hint="30 caractères maximum.">
              <input
                id="telephone"
                name="telephone"
                maxLength={30}
                defaultValue={partner.phone ?? ""}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Adresse" htmlFor="adresse" hint="200 caractères maximum.">
              <input
                id="adresse"
                name="adresse"
                maxLength={200}
                defaultValue={partner.addressLine ?? ""}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Ville" htmlFor="ville" hint="80 caractères maximum.">
              <input
                id="ville"
                name="ville"
                maxLength={80}
                defaultValue={partner.city ?? ""}
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
                defaultValue={partner.countryCode ?? ""}
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Localisation</h2>
          <p className="mt-2 text-[10px] leading-4 text-muted">
            Les deux coordonnées vont ensemble : renseignées, la fiche apparaît sur la carte du
            registre. Laissez les deux vides pour l&apos;en retirer.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Latitude" htmlFor="latitude" hint="Degrés décimaux, de -90 à 90.">
              <input
                id="latitude"
                name="latitude"
                inputMode="decimal"
                defaultValue={partner.latitude ?? ""}
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label="Longitude" htmlFor="longitude" hint="Degrés décimaux, de -180 à 180.">
              <input
                id="longitude"
                name="longitude"
                inputMode="decimal"
                defaultValue={partner.longitude ?? ""}
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
                defaultValue={partner.taxNumber ?? ""}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Délai de paiement (jours)"
              htmlFor="delai_paiement_jours"
              hint={`Entier de 0 à ${MAX_PAYMENT_TERM_DAYS}.`}
            >
              <input
                id="delai_paiement_jours"
                name="delai_paiement_jours"
                type="number"
                min={0}
                max={MAX_PAYMENT_TERM_DAYS}
                step={1}
                defaultValue={partner.paymentTermDays}
                className={INPUT_CLASS}
              />
            </Field>
            <CheckboxField
              name="actif"
              label="Actif"
              hint="Un tiers inactif reste visible."
              defaultChecked={partner.active}
            />
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href={`/tiers/${partner.id}`}
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
