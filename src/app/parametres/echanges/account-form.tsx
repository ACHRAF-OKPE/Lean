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
  helpOpen = false,
}: {
  account: EmailAccountSummary | null;
  editable: boolean;
  helpOpen?: boolean;
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

      <details
        open={helpOpen || !account?.hasPassword}
        className="rounded-lg border border-line bg-canvas/50 px-4 py-3"
      >
        <summary className="cursor-pointer text-[11px] font-semibold text-brand-strong">
          Aide : quel mot de passe utiliser ?
        </summary>
        <div className="mt-3 space-y-3 text-[10px] leading-4 text-muted">
          <p>
            Gmail, Outlook, Yahoo et la plupart des hébergeurs n&apos;acceptent plus le mot de passe
            habituel du compte pour l&apos;envoi depuis une application. Il faut créer un{" "}
            <strong className="font-semibold text-ink">mot de passe d&apos;application</strong> :
            une clé de 16 caractères, réservée à Lean, révocable à tout moment sans changer votre
            mot de passe principal.
          </p>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-line bg-panel p-3">
              <p className="text-[11px] font-medium text-ink">Gmail / Google Workspace</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>
                  Activez la validation en deux étapes :{" "}
                  <a
                    href="https://myaccount.google.com/security"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline underline-offset-2 hover:text-brand-strong"
                  >
                    myaccount.google.com/security
                  </a>
                </li>
                <li>
                  Créez un mot de passe d&apos;application nommé « Lean » :{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline underline-offset-2 hover:text-brand-strong"
                  >
                    myaccount.google.com/apppasswords
                  </a>
                </li>
                <li>Collez le code de 16 caractères dans le champ Mot de passe ci-dessous.</li>
              </ol>
              <p className="mt-2">
                Serveur <span className="font-mono text-ink">smtp.gmail.com</span>, port{" "}
                <span className="font-mono text-ink">465</span>, sécurité{" "}
                <span className="text-ink">TLS implicite</span>.
              </p>
              <p className="mt-1">
                Aide Google :{" "}
                <a
                  href="https://support.google.com/accounts/answer/185833"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline underline-offset-2 hover:text-brand-strong"
                >
                  support.google.com/accounts/answer/185833
                </a>
              </p>
            </div>

            <div className="rounded-md border border-line bg-panel p-3">
              <p className="text-[11px] font-medium text-ink">Outlook / Microsoft 365</p>
              <p className="mt-2">
                Créez le mot de passe d&apos;application depuis{" "}
                <a
                  href="https://account.microsoft.com/security"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline underline-offset-2 hover:text-brand-strong"
                >
                  account.microsoft.com/security
                </a>{" "}
                (Sécurité → Options avancées).
              </p>
              <p className="mt-2">
                Serveur <span className="font-mono text-ink">smtp-mail.outlook.com</span>, port{" "}
                <span className="font-mono text-ink">587</span>, sécurité{" "}
                <span className="text-ink">STARTTLS</span>. En entreprise, l&apos;administrateur
                doit d&apos;abord autoriser l&apos;authentification SMTP.
              </p>
            </div>
          </div>

          <p>
            Compte Google Workspace : seuls les administrateurs peuvent ouvrir les mots de passe
            d&apos;application. Si l&apos;option est absente, demandez son activation ou utilisez
            une adresse Gmail personnelle pour la recette.
          </p>
          <p>
            Le mot de passe d&apos;application ne donne pas accès à votre boîte : il ne sert
            qu&apos;à l&apos;envoi et se révoque sans toucher au mot de passe principal.
          </p>
        </div>
      </details>

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
                  ? "Laisser vide pour conserver le mot de passe actuel. Gmail : mot de passe d'application obligatoire."
                  : "Chiffré au repos, jamais relu ensuite. Gmail : mot de passe d'application obligatoire."
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
