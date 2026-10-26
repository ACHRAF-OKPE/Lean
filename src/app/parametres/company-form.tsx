"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { updateCompanyAction } from "@/lib/settings/actions";
import { EMPTY_SETTINGS_FORM_STATE } from "@/lib/settings/form-state";
import type { CompanySettingsSummary } from "@/modules/settings/queries";
import { INCOTERMS } from "@/modules/sales/validation";

const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-24 resize-y`;

export function CompanyForm({
  settings,
  fallbackLegalName,
  editable,
}: {
  settings: CompanySettingsSummary | null;
  fallbackLegalName: string;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateCompanyAction,
    EMPTY_SETTINGS_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-6 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />

      <fieldset disabled={!editable || pending} className="space-y-6">
        <legend className="sr-only">Fiche entreprise</legend>

        <section>
          <h2 className="text-sm font-semibold">Identité légale</h2>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            Ces informations figurent sur les documents et servent de base aux modèles
            d&apos;échange.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="Raison sociale"
              htmlFor="legalName"
              hint="Obligatoire, 160 caractères maximum."
            >
              <input
                id="legalName"
                name="legalName"
                required
                maxLength={160}
                defaultValue={settings?.legalName ?? fallbackLegalName}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Forme juridique" htmlFor="legalForm" hint="SARL, SA, SAS, EI…">
              <input
                id="legalForm"
                name="legalForm"
                maxLength={120}
                defaultValue={settings?.legalForm ?? ""}
                placeholder="SARL"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Capital (XOF)"
              htmlFor="capitalXof"
              hint="Entier, sans décimale ni devise."
            >
              <input
                id="capitalXof"
                name="capitalXof"
                inputMode="numeric"
                defaultValue={settings?.capitalXof ?? ""}
                placeholder="10000000"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field label="Numéro fiscal" htmlFor="taxId" hint="40 caractères maximum.">
              <input
                id="taxId"
                name="taxId"
                maxLength={40}
                defaultValue={settings?.taxId ?? ""}
                placeholder="CI123456789"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="RCCM" htmlFor="rccm" hint="Registre du commerce, 40 caractères maximum.">
              <input
                id="rccm"
                name="rccm"
                maxLength={40}
                defaultValue={settings?.rccm ?? ""}
                placeholder="CI-ABJ-2026-B-12345"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Coordonnées</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Adresse" htmlFor="addressLine" hint="200 caractères maximum.">
              <input
                id="addressLine"
                name="addressLine"
                maxLength={200}
                defaultValue={settings?.addressLine ?? ""}
                placeholder="Zone industrielle de Yopougon"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Ville" htmlFor="city" hint="80 caractères maximum.">
              <input
                id="city"
                name="city"
                maxLength={80}
                defaultValue={settings?.city ?? ""}
                placeholder="Abidjan"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Code postal" htmlFor="postalCode" hint="16 caractères maximum.">
              <input
                id="postalCode"
                name="postalCode"
                maxLength={16}
                defaultValue={settings?.postalCode ?? ""}
                placeholder="00225"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Pays" htmlFor="countryCode" hint="Code ISO 3166-1, par exemple CI.">
              <input
                id="countryCode"
                name="countryCode"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                defaultValue={settings?.countryCode ?? ""}
                placeholder="CI"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field label="E-mail" htmlFor="companyEmail" hint="Adresse de contact de l'entreprise.">
              <input
                id="companyEmail"
                name="email"
                type="email"
                maxLength={160}
                autoComplete="off"
                defaultValue={settings?.email ?? ""}
                placeholder="contact@exemple.com"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Téléphone" htmlFor="companyPhone" hint="30 caractères maximum.">
              <input
                id="companyPhone"
                name="phone"
                maxLength={30}
                defaultValue={settings?.phone ?? ""}
                placeholder="+225 27 00 00 00 00"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Site web"
              htmlFor="website"
              hint="Sans schéma, https:// est ajouté et signalé."
            >
              <input
                id="website"
                name="website"
                maxLength={200}
                defaultValue={settings?.website ?? ""}
                placeholder="https://exemple.com"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Règlement et mentions</h2>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            Valeurs proposées par défaut. Elles ne modifient aucun document existant.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="Délai de règlement (jours)"
              htmlFor="paymentTermDays"
              hint="Entier de 0 à 365."
            >
              <input
                id="paymentTermDays"
                name="paymentTermDays"
                type="number"
                min={0}
                max={365}
                step={1}
                defaultValue={settings?.paymentTermDays ?? 0}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Incoterm par défaut"
              htmlFor="defaultIncoterm"
              hint="Incoterms 2020, facultatif."
            >
              <select
                id="defaultIncoterm"
                name="defaultIncoterm"
                defaultValue={settings?.defaultIncoterm ?? ""}
                className={INPUT_CLASS}
              >
                <option value="">Aucun</option>
                {INCOTERMS.map((incoterm) => (
                  <option key={incoterm} value={incoterm}>
                    {incoterm}
                  </option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Mentions de facture"
                htmlFor="invoiceFooter"
                hint="500 caractères maximum, reportés en pied de facture."
              >
                <textarea
                  id="invoiceFooter"
                  name="invoiceFooter"
                  maxLength={500}
                  defaultValue={settings?.invoiceFooter ?? ""}
                  placeholder="Paiement par virement au compte indiqué. Tout retard entraîne des pénalités."
                  className={TEXTAREA_CLASS}
                />
              </Field>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Coordonnées bancaires</h2>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            Bloc facultatif : banque, titulaire et numéro de compte vont ensemble.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Banque" htmlFor="bankName" hint="80 caractères maximum.">
              <input
                id="bankName"
                name="bankName"
                maxLength={80}
                defaultValue={settings?.bankName ?? ""}
                placeholder="Banque Atlantique"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Titulaire du compte"
              htmlFor="bankAccountHolder"
              hint="120 caractères maximum."
            >
              <input
                id="bankAccountHolder"
                name="bankAccountHolder"
                maxLength={120}
                defaultValue={settings?.bankAccountHolder ?? ""}
                placeholder="Sahel Distribution SARL"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Numéro de compte / IBAN"
              htmlFor="bankAccountNumber"
              hint="5 à 34 caractères alphanumériques ; espaces retirés."
            >
              <input
                id="bankAccountNumber"
                name="bankAccountNumber"
                maxLength={34}
                defaultValue={settings?.bankAccountNumber ?? ""}
                placeholder="CI930010000000000000"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
            <Field
              label="SWIFT / BIC"
              htmlFor="bankSwift"
              hint="8 ou 11 caractères alphanumériques, facultatif."
            >
              <input
                id="bankSwift"
                name="bankSwift"
                maxLength={11}
                defaultValue={settings?.bankSwift ?? ""}
                placeholder="ATLNCIAB"
                className={`${INPUT_CLASS} font-mono uppercase`}
              />
            </Field>
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href="/"
          aria-label="Revenir au poste de pilotage"
          title="Revenir au poste de pilotage"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        {editable ? (
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer la fiche entreprise"
            title="Enregistrer la fiche entreprise"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="text-[10px] text-muted">
            Lecture seule : la modification exige la permission paramètres.
          </span>
        )}
      </div>
    </form>
  );
}
