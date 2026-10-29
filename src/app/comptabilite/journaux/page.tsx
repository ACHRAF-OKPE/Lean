import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, BookMarked } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { JournalForm, JournalToggleButton } from "@/components/accounting-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ACCOUNTING_JOURNAL_TYPE_LABELS } from "@/modules/accounting/constants";
import { listJournals } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Journaux comptables",
};

const TH = "px-4 py-2.5 font-normal";

export default function JournalsPage(props: PageProps<"/comptabilite/journaux">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des journaux…" />}>
      <JournalsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function JournalsContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/journaux">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [journals, memberships, query] = await Promise.all([
    listJournals(db, { tenantId: session.tenantId }),
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
        <div className="flex items-center gap-3">
          <Link
            href="/comptabilite"
            aria-label="Revenir à la comptabilité"
            title="Revenir à la comptabilité"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Comptabilité
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Journaux</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque journal numérote ses écritures par exercice sous la forme{" "}
          <span className="font-mono text-[10px]">CODE-AAAA-0001</span>. Un journal inactif garde
          ses écritures mais refuse toute nouvelle saisie.
        </p>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Journal créé.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Statut du journal mis à jour.
          </p>
        ) : null}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <BookMarked className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Ajouter un journal</h2>
            </div>
            <JournalForm />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {journals.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <BookMarked className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun journal dans cet espace. Créez au moins un journal actif pour saisir une
                écriture.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Journaux comptables de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={TH}>
                      Type
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
                  {journals.map((journal) => (
                    <tr key={journal.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{journal.code}</td>
                      <td className="px-4 py-2.5">{journal.label}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {ACCOUNTING_JOURNAL_TYPE_LABELS[journal.type]}
                      </td>
                      <td className="px-4 py-2.5">
                        {journal.active ? (
                          <span className="font-mono text-[10px] text-brand-strong">Actif</span>
                        ) : (
                          <span className="font-mono text-[10px] text-muted">Inactif</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <JournalToggleButton
                              journalId={journal.id}
                              code={journal.code}
                              active={journal.active}
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
      </main>
    </div>
  );
}
