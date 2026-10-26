"use client";

import { useActionState } from "react";
import { Check, LoaderCircle, Mail } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { saveEmailAccountAction } from "@/lib/exchange/actions";
import { EMPTY_EXCHANGE_FORM_STATE } from "@/lib/exchange/form-state";
import type { EmailAccountSummary } from "@/modules/exchange/queries";
import { EMAIL_SECURITY_MODES } from "@/modules/exchange/validation";

export function AccountForm({
  account,
  editable,
}: {
  account: EmailAccountSummary | null;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    saveEmailAccountAction,
    EMPTY_EXCHANGE_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-6 rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Compte d&apos;envoi SMTP</h2>
        {account ? (
          <span className="ml-auto rounded-full border border-line bg-canvas px-2 py-0.5 text-[9px] text-muted">
            {account.active ? "Actif" : "Inactif"}
          </span>
        ) : null}
      </div>

      <FormErrors errors={state.errors} />

      <fieldset disabled={!editable || pending} className="space-y-6">
        <legend className="sr-only">Compte d&apos;envoi SMTP</legend>

        <section>
          <h3 className="text-[11px] font-semibold">Serveur</h3>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            Un seul compte par espace. TLS implicite utilise généralement le port 465, STARTTLS le
            port 587.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Nom du compte" htmlFor="accountName" hint="1 à 80 caractères.">
              <input
                id="accountName"
                name="name"
                required
                maxLength={80}
                defaultValue={account?.name ?? ""}
                placeholder="SMTP transactionnel"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Hôte" htmlFor="host" hint="Nom du serveur, sans espace.">
              <input
                id="host"
                name="host"
                required
                maxLength={255}
                autoComplete="off"
                defaultValue={account?.host ?? ""}
                placeholder="smtp.exemple.com"
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field label="Port" htmlFor="port" hint="Entier entre 1 et 65535.">
              <input
                id="port"
                name="port"
                required
                inputMode="numeric"
                maxLength={5}
                defaultValue={account?.port ?? 587}
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field label="Sécurité" htmlFor="security" hint="TLS, STARTTLS ou aucun chiffrement.">
              <select
                id="security"
                name="security"
                defaultValue={account?.security ?? "starttls"}
                className={INPUT_CLASS}
              >
                {EMAIL_SECURITY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "tls"
                      ? "TLS implicite"
                      : mode === "starttls"
                        ? "STARTTLS"
                        : "Aucun chiffrement"}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Identifiant"
              htmlFor="username"
              hint="Facultatif si le serveur n'exige pas d'authentification."
            >
              <input
                id="username"
                name="username"
                maxLength={120}
                autoComplete="off"
                defaultValue={account?.username ?? ""}
                className={`${INPUT_CLASS} font-mono`}
              />
            </Field>
            <Field
              label="Mot de passe"
              htmlFor="password"
              hint={
                account?.hasPassword
                  ? "Laisser vide pour conserver le mot de passe actuel."
                  : "Chiffré au repos, jamais relu ensuite."
              }
            >
              <input
                id="password"
                name="password"
                type="password"
                maxLength={200}
                autoComplete="new-password"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          {account?.hasPassword ? (
            <div className="mt-3">
              <CheckboxField
                name="removePassword"
                label="Retirer le mot de passe enregistré"
                hint="L'identifiant sera également retiré si vous le videz."
                defaultChecked={false}
              />
            </div>
          ) : null}
        </section>

        <section>
          <h3 className="text-[11px] font-semibold">Expéditeur</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Nom affiché" htmlFor="fromName" hint="1 à 120 caractères.">
              <input
                id="fromName"
                name="fromName"
                required
                maxLength={120}
                defaultValue={account?.fromName ?? ""}
                placeholder="Lean Achats"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Adresse d'expédition" htmlFor="fromAddress" hint="Adresse validée.">
              <input
                id="fromAddress"
                name="fromAddress"
                type="email"
                required
                maxLength={160}
                autoComplete="off"
                defaultValue={account?.fromAddress ?? ""}
                placeholder="achats@exemple.com"
                className={INPUT_CLASS}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Réponse à"
                htmlFor="replyTo"
                hint="Facultatif : adresse de réponse si différente de l'expéditeur."
              >
                <input
                  id="replyTo"
                  name="replyTo"
                  type="email"
                  maxLength={160}
                  autoComplete="off"
                  defaultValue={account?.replyTo ?? ""}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
          </div>
        </section>

        <CheckboxField
          name="active"
          label="Compte actif"
          hint="Un compte inactif bloque les envois et les tests."
          defaultChecked={account?.active ?? true}
        />
      </fieldset>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <span className="text-[10px] text-muted">
          {account ? "Les changements sont audités." : "Aucun compte configuré."}
        </span>
        {editable ? (
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le compte d'envoi"
            title="Enregistrer le compte d'envoi"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
    </form>
  );
}
