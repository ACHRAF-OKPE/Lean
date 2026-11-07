"use client";

import { useActionState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { updatePartnerBankAccountAction } from "@/lib/catalog/actions";
import type { PartnerBankAccountRecord } from "@/modules/catalog/partner-bank-account-queries";

const EMPTY_STATE = { errors: [] as readonly string[], saved: false };

export function PartnerBankForm({
  partnerId,
  account,
}: {
  partnerId: string;
  account: PartnerBankAccountRecord | null;
}) {
  const [state, formAction, pending] = useActionState(updatePartnerBankAccountAction, EMPTY_STATE);

  return (
    <form action={formAction} className="mt-5 space-y-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="partnerId" value={partnerId} />
      <div>
        <h2 className="text-sm font-semibold">Coordonnées de règlement fournisseur</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          Accès réservé aux personnes ayant le niveau gérer dans Achats ou Comptabilité. La fiche
          peut rester incomplète jusqu’à la collecte des justificatifs bancaires.
        </p>
      </div>
      <FormErrors errors={state.errors} />
      {state.saved ? (
        <p className="text-xs text-emerald-700">Coordonnées bancaires enregistrées.</p>
      ) : null}
      <fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
        <Field label="Banque" htmlFor="bank_name">
          <input
            id="bank_name"
            name="bank_name"
            maxLength={120}
            defaultValue={account?.bankName ?? ""}
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
            defaultValue={account?.bankCountryCode ?? ""}
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Intitulé du compte" htmlFor="account_holder">
          <input
            id="account_holder"
            name="account_holder"
            maxLength={120}
            defaultValue={account?.accountHolder ?? ""}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Code banque" htmlFor="bank_code">
          <input
            id="bank_code"
            name="bank_code"
            maxLength={20}
            defaultValue={account?.bankCode ?? ""}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Code guichet" htmlFor="branch_code">
          <input
            id="branch_code"
            name="branch_code"
            maxLength={20}
            defaultValue={account?.branchCode ?? ""}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Numéro de compte" htmlFor="account_number">
          <input
            id="account_number"
            name="account_number"
            maxLength={34}
            defaultValue={account?.accountNumber ?? ""}
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>
        <Field label="Clé RIB" htmlFor="rib_key" hint="Jusqu’à deux chiffres.">
          <input
            id="rib_key"
            name="rib_key"
            maxLength={2}
            defaultValue={account?.ribKey ?? ""}
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>
        <Field
          label="IBAN"
          htmlFor="iban"
          hint="La clé de contrôle est vérifiée à l’enregistrement."
        >
          <input
            id="iban"
            name="iban"
            maxLength={34}
            defaultValue={account?.iban ?? ""}
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="BIC / SWIFT" htmlFor="bic" hint="8 ou 11 caractères, au format BIC.">
          <input
            id="bic"
            name="bic"
            maxLength={11}
            defaultValue={account?.bic ?? ""}
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
      </fieldset>
      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer les coordonnées bancaires"
          title="Enregistrer les coordonnées bancaires"
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
