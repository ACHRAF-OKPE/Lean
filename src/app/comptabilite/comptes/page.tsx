import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Download, ListTree, Upload } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AccountForm, AccountToggleButton } from "@/components/accounting-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ACCOUNTING_LIST_LIMIT } from "@/modules/accounting/constants";
import { listAccounts } from "@/modules/accounting/queries";
import { IMPORT_KIND_PATHS, IMPORT_TEMPLATE_PATHS } from "@/modules/catalog/constants";

export const metadata: Metadata = {
  title: "Plan comptable",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function AccountsPage(props: PageProps<"/comptabilite/comptes">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du plan comptable…" />}>
      <AccountsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AccountsContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/comptes">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [accounts, memberships, query] = await Promise.all([
    listAccounts(db, { tenantId: session.tenantId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/comptabilite"
              aria-label="Revenir à la comptabilité"
              title="Revenir à la comptabilité"
              className={ACTION_LINK}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                Comptabilité
              </p>
              <h1 className="text-2xl font-medium tracking-tight">Plan comptable</h1>
            </div>
          </div>
          {canWrite ? (
            <div className="flex items-center gap-1.5">
              <Link
                href={`${IMPORT_KIND_PATHS.accounts}/import`}
                aria-label="Importer le plan comptable"
                title="Importer le plan comptable"
                className={ACTION_LINK}
              >
                <Upload className="size-4" aria-hidden="true" />
              </Link>
              <a
                href={IMPORT_TEMPLATE_PATHS.accounts}
                aria-label="Télécharger le modèle XLSX du plan comptable"
                title="Télécharger le modèle XLSX"
                className={ACTION_LINK}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
            </div>
          ) : null}
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Comptes SYSCOHADA des classes 1 à 8. La classe découle du premier chiffre du code. Un
          compte désactivé reste lisible dans les écritures passées mais ne peut plus être choisi.
        </p>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Compte créé.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Statut du compte mis à jour.
          </p>
        ) : null}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <ListTree className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Ajouter un compte</h2>
            </div>
            <AccountForm />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {accounts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ListTree className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Plan comptable vide. Importez-le en XLSX ou saisissez les comptes utiles.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Plan comptable de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Classe
                    </th>
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Activer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                        {account.accountClass}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {account.code}
                      </td>
                      <td className="px-4 py-2.5">{account.label}</td>
                      <td className="px-4 py-2.5">
                        {account.active ? (
                          <span className="font-mono text-[10px] text-brand-strong">Actif</span>
                        ) : (
                          <span className="font-mono text-[10px] text-muted">Inactif</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <AccountToggleButton
                              accountId={account.id}
                              code={account.code}
                              active={account.active}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {accounts.length === ACCOUNTING_LIST_LIMIT ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des {ACCOUNTING_LIST_LIMIT} premiers comptes par classe et par code.
          </p>
        ) : null}
      </main>
    </div>
  );
}
