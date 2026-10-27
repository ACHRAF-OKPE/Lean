import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, MailPlus, PlugZap, Send, Settings2, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  getEmailAccount,
  listExchangeMessages,
  listExchangeTemplates,
} from "@/modules/exchange/queries";
import { BUILTIN_TEMPLATES, EXCHANGE_TYPE_LABELS } from "@/modules/exchange/templates";
import { AccountForm } from "./account-form";
import { TestConnectionButton } from "./test-connection-button";

export const metadata: Metadata = {
  title: "Échanges — Paramètres",
};

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function queryText(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = query[key];
  return typeof value === "string" ? value : null;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (queryText(query, "compte") === "enregistre") {
    return {
      tone: "success",
      text: "Compte d'envoi enregistré. Le mot de passe, s'il est conservé, reste chiffré et n'est jamais relu par l'interface.",
    };
  }
  if (queryText(query, "modele") === "cree") {
    return { tone: "success", text: "Modèle créé ; il est disponible pour les prochains envois." };
  }
  if (queryText(query, "modele") === "maj") {
    return {
      tone: "success",
      text: "Modèle mis à jour. Les messages déjà journalisés conservent leur contenu d'origine.",
    };
  }
  if (queryText(query, "test") === "ok") {
    return {
      tone: "success",
      text: `Connexion SMTP validée avec ${queryText(query, "hote") ?? "le serveur"}.`,
    };
  }
  if (queryText(query, "test") === "echec") {
    return {
      tone: "warning",
      text: `Connexion refusée : ${queryText(query, "raison") ?? "vérifiez les paramètres du compte."}`,
    };
  }
  return null;
}

export default function ExchangeSettingsPage(props: PageProps<"/parametres/echanges">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des échanges…" />}>
      <ExchangeSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ExchangeSettingsContent({
  searchParams,
}: Pick<PageProps<"/parametres/echanges">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [account, templates, messages, memberships, query] = await Promise.all([
    getEmailAccount(db, session.tenantId),
    listExchangeTemplates(db, session.tenantId),
    listExchangeMessages(db, { tenantId: session.tenantId, limit: 5 }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const editable = can(session.role, "settings.manage");
  const banner = bannerFor(query);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="settings" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/parametres"
            aria-label="Revenir aux paramètres"
            title="Revenir aux paramètres"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Socle · échanges
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">
              Compte et modèles d&apos;échange
            </h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Un compte SMTP par espace de travail, chiffré au repos, et des modèles de demande ou
              de confirmation fournisseur composés de variables. Chaque envoi joint le bon de
              commande en PDF et laisse une trace inaltérable au journal.
            </p>
          </div>
          <Link
            href="/echanges"
            aria-label="Ouvrir le journal des échanges"
            title="Journal des échanges"
            className="ml-auto grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <Send className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {banner ? (
          <p
            role="status"
            className={`mt-5 rounded-md border px-3 py-2 text-[11px] leading-5 ${
              banner.tone === "success"
                ? "border-brand/20 bg-brand-soft text-brand-strong"
                : "border-copper/20 bg-copper-soft text-copper"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        {!editable ? (
          <p className="mt-5 rounded-md border border-line bg-panel px-3 py-2 text-[11px] leading-5 text-muted">
            Votre rôle permet de consulter la configuration, pas de la modifier. Demandez à un
            propriétaire ou à un administrateur.
          </p>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <AccountForm
              account={account}
              editable={editable}
              helpOpen={queryText(query, "test") === "echec"}
            />

            <section className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
                <MailPlus className="size-4 text-brand" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Modèles</h2>
                <span className="font-mono text-[10px] text-muted">{templates.length}</span>
                {editable ? (
                  <Link
                    href="/parametres/echanges/modeles/nouveau"
                    aria-label="Créer un modèle d'échange"
                    title="Créer un modèle d'échange"
                    className="ml-auto grid size-8 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40"
                  >
                    <MailPlus className="size-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>

              {templates.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-[11px] text-muted">
                    Aucun modèle personnalisé. Les modèles intégrés servent de repli.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <caption className="sr-only">Modèles d&apos;échange de l&apos;espace</caption>
                    <thead>
                      <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                        <th scope="col" className="px-4 py-2.5 font-normal">
                          Type
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-normal">
                          Nom
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-normal">
                          État
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-normal">
                          Modifié
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-normal">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((template) => (
                        <tr key={template.id} className="border-b border-line last:border-b-0">
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                            {EXCHANGE_TYPE_LABELS[template.type]}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block font-medium">{template.name}</span>
                            <span className="block max-w-72 truncate text-[10px] text-muted">
                              {template.subject}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {template.isDefault ? (
                                <span className="inline-flex rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 text-[9px] whitespace-nowrap text-brand-strong">
                                  Défaut
                                </span>
                              ) : null}
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] whitespace-nowrap ${
                                  template.active
                                    ? "border-line bg-canvas text-muted"
                                    : "border-copper/20 bg-copper-soft text-copper"
                                }`}
                              >
                                {template.active ? "Actif" : "Inactif"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                            {new Intl.DateTimeFormat("fr-FR", {
                              dateStyle: "short",
                              timeZone: "Africa/Abidjan",
                            }).format(template.updatedAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/parametres/echanges/modeles/${template.id}`}
                              aria-label={`Modifier le modèle ${template.name}`}
                              title="Modifier le modèle"
                              className="inline-grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                            >
                              <Settings2 className="size-3.5" aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <PlugZap className="size-4 text-brand" aria-hidden="true" />
                État du compte
              </h2>
              <dl className="mt-3 space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Compte</dt>
                  <dd className="font-medium">{account ? account.name : "Non configuré"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Serveur</dt>
                  <dd className="font-mono text-[10px]">
                    {account ? `${account.host}:${account.port}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Sécurité</dt>
                  <dd className="font-mono text-[10px] uppercase">{account?.security ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Expéditeur</dt>
                  <dd className="max-w-40 truncate font-mono text-[10px]">
                    {account?.fromAddress ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Mot de passe</dt>
                  <dd className="font-medium">
                    {account?.hasPassword ? "Chiffré, non relu" : "Aucun"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Activation</dt>
                  <dd className="font-medium">
                    {account ? (account.active ? "Actif" : "Inactif") : "—"}
                  </dd>
                </div>
              </dl>
              {editable && account ? (
                <div className="mt-4 border-t border-line pt-4">
                  <TestConnectionButton disabled={!account.active} />
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
                Traçabilité
              </h2>
              <p className="mt-2 text-[10px] leading-4 text-muted">
                Le mot de passe est chiffré avec la clé de l&apos;application et n&apos;est jamais
                renvoyé au navigateur. Les tests, enregistrements et envois écrivent un évènement
                d&apos;audit.
              </p>
              <p className="mt-2 font-mono text-[10px] text-muted">
                Derniers messages : {messages.length}
              </p>
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="text-sm font-semibold">Modèles intégrés</h2>
              <p className="mt-1 text-[10px] leading-4 text-muted">
                Utilisés quand aucun modèle par défaut n&apos;est actif. Lecture seule.
              </p>
              <div className="mt-3 space-y-2">
                {(Object.keys(BUILTIN_TEMPLATES) as (keyof typeof BUILTIN_TEMPLATES)[]).map(
                  (type) => (
                    <details
                      key={type}
                      className="rounded-md border border-line bg-canvas px-3 py-2"
                    >
                      <summary className="cursor-pointer text-[11px] font-medium">
                        {EXCHANGE_TYPE_LABELS[type]}
                      </summary>
                      <p className="mt-2 font-mono text-[10px] leading-4 text-muted">
                        {BUILTIN_TEMPLATES[type].subject}
                      </p>
                      <pre className="mt-1 overflow-x-auto text-[10px] leading-4 whitespace-pre-wrap text-muted">
                        {BUILTIN_TEMPLATES[type].body}
                      </pre>
                    </details>
                  ),
                )}
              </div>
              <Link
                href="/echanges"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline"
              >
                <Send className="size-3.5" aria-hidden="true" />
                Journal des envois
              </Link>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
