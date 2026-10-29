import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Download, NotebookPen, Plus, Upload } from "lucide-react";
import { EntryStatusBadge } from "@/components/accounting-badges";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ACCOUNTING_LIST_LIMIT } from "@/modules/accounting/constants";
import { listJournalEntries } from "@/modules/accounting/queries";
import { IMPORT_KIND_PATHS, IMPORT_TEMPLATE_PATHS } from "@/modules/catalog/constants";

export const metadata: Metadata = {
  title: "Écritures comptables",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const FILTERS = [
  { value: "", label: "Toutes" },
  { value: "draft", label: "Brouillons" },
  { value: "validated", label: "Validées" },
] as const;

export default function JournalEntriesPage(props: PageProps<"/comptabilite/ecritures">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des écritures…" />}>
      <JournalEntriesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function JournalEntriesContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/ecritures">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const query = await searchParams;
  const statusFilter =
    query.statut === "draft" ? "draft" : query.statut === "validated" ? "validated" : undefined;
  const [entries, memberships] = await Promise.all([
    listJournalEntries(db, { tenantId: session.tenantId, status: statusFilter }),
    listMembershipsForUser(db, session.userId),
  ]);
  const canWrite = can(session.role, "data.write");
  const deleted = typeof query.supprime === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
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
              <h1 className="text-2xl font-medium tracking-tight">Écritures</h1>
            </div>
          </div>
          {canWrite ? (
            <div className="flex items-center gap-1.5">
              <Link
                href="/comptabilite/ecritures/nouvelle"
                aria-label="Saisir une écriture"
                title="Saisir une écriture"
                className={ACTION_LINK}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href={`${IMPORT_KIND_PATHS.journal_entries}/import`}
                aria-label="Importer des écritures"
                title="Importer des écritures"
                className={ACTION_LINK}
              >
                <Upload className="size-4" aria-hidden="true" />
              </Link>
              <a
                href={IMPORT_TEMPLATE_PATHS.journal_entries}
                aria-label="Télécharger le modèle XLSX des écritures"
                title="Télécharger le modèle XLSX"
                className={ACTION_LINK}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
            </div>
          ) : null}
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Une écriture est numérotée par journal et par exercice dès sa création. Le brouillon peut
          être supprimé ; la validation est définitive et alimente la balance et le grand livre.
        </p>

        {deleted ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Brouillon supprimé.
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-1.5">
          {FILTERS.map((filter) => {
            const active = (statusFilter ?? "") === filter.value;
            return (
              <Link
                key={filter.label}
                href={
                  filter.value
                    ? `/comptabilite/ecritures?statut=${filter.value}`
                    : "/comptabilite/ecritures"
                }
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
                  active
                    ? "border-brand/20 bg-brand-soft text-brand-strong"
                    : "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>

        <section className="mt-3 overflow-hidden rounded-xl border border-line bg-panel">
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <NotebookPen className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune écriture pour ce filtre. Saisissez-la ou importez-la depuis le modèle XLSX.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Écritures comptables de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Numéro
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Journal
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={TH}>
                      Exercice
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Débit
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {entry.number}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(entry.entryDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="block font-mono text-[10px]">{entry.journalCode}</span>
                        <span className="block text-[10px] text-muted">{entry.journalLabel}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{entry.label}</span>
                        {entry.reference ? (
                          <span className="block font-mono text-[10px] text-muted">
                            {entry.reference}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-muted">
                        {entry.fiscalYearLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(entry.totalDebit)}
                      </td>
                      <td className="px-4 py-2.5">
                        <EntryStatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/comptabilite/ecritures/${entry.id}`}
                          aria-label={`Ouvrir l'écriture ${entry.number}`}
                          title="Ouvrir l'écriture"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {entries.length === ACCOUNTING_LIST_LIMIT ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des {ACCOUNTING_LIST_LIMIT} écritures les plus récentes.
          </p>
        ) : null}
      </main>
    </div>
  );
}
