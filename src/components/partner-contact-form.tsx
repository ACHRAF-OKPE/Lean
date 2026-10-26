"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createContactAction, updateContactAction } from "@/lib/settings/actions";
import { EMPTY_SETTINGS_FORM_STATE } from "@/lib/settings/form-state";

export interface ContactFormValues {
  readonly id: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly isPrimary: boolean;
  readonly active: boolean;
}

export function PartnerContactForm({
  partnerId,
  contact,
}: {
  partnerId: string;
  contact: ContactFormValues | null;
}) {
  const [state, formAction, pending] = useActionState(
    contact ? updateContactAction : createContactAction,
    EMPTY_SETTINGS_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-6 space-y-6 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="partnerId" value={partnerId} />
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Contact du tiers</legend>

        <section>
          <h2 className="text-sm font-semibold">Identité</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="Nom complet"
              htmlFor="fullName"
              hint="Obligatoire, 120 caractères maximum."
            >
              <input
                id="fullName"
                name="fullName"
                required
                maxLength={120}
                autoFocus
                defaultValue={contact?.fullName ?? ""}
                placeholder="Aminata Koné"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Fonction" htmlFor="jobTitle" hint="80 caractères maximum.">
              <input
                id="jobTitle"
                name="jobTitle"
                maxLength={80}
                defaultValue={contact?.jobTitle ?? ""}
                placeholder="Responsable achats"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Coordonnées</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field
              label="E-mail"
              htmlFor="contactEmail"
              hint="Facultatif ; un contact sans coordonnée reste possible."
            >
              <input
                id="contactEmail"
                name="email"
                type="email"
                maxLength={160}
                autoComplete="off"
                defaultValue={contact?.email ?? ""}
                placeholder="aminata.kone@exemple.com"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Téléphone" htmlFor="contactPhone" hint="30 caractères maximum.">
              <input
                id="contactPhone"
                name="phone"
                maxLength={30}
                defaultValue={contact?.phone ?? ""}
                placeholder="+225 07 00 00 00 00"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Statut</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <CheckboxField
              name="isPrimary"
              label="Contact principal"
              hint="Un seul principal par tiers ; l'ancien est retiré."
              defaultChecked={contact?.isPrimary ?? false}
            />
            <CheckboxField
              name="active"
              label="Contact actif"
              hint="Un contact inactif reste consultable."
              defaultChecked={contact?.active ?? true}
            />
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href={`/tiers/${partnerId}`}
          aria-label="Annuler et revenir au tiers"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label={contact ? "Enregistrer le contact" : "Créer le contact"}
          title={contact ? "Enregistrer le contact" : "Créer le contact"}
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
