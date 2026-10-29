import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Lock, NotebookPen } from "lucide-react";
import { EntrySourceBadge, EntryStatusBadge } from "@/components/accounting-badges";
import { DeleteEntryButton, ValidateEntryButton } from "@/components/accounting-forms";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getJournalEntry } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Écriture comptable",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function bannerFor(query: Record<string, string | string[] | undefined>): string | null {
  if (typeof query.cree === "string") {
    return "Écriture créée en brouillon. Vérifiez les lignes puis validez-la.";
  }
  if (typeof query.valide === "string") {
    return "Écriture validée : elle est désormais définitive et alimente la balance et le grand livre.";
  }
  return null;
}

export default function JournalEntryPage(props: PageProps<"/comptabilite/ecritures/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de l'écriture…" />}>
      <JournalEntryContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function JournalEntryContent({
  params,
  searchParams,
}: Pick<PageProps<"/comptabilite/ecritures/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id: entryId } = await params;
  if (!UUID_PATTERN.test(entryId)) {
    notFound();
  }

  const db = getDb();
  const [entry, memberships, query] = await Promise.all([
    getJournalEntry(db, { tenantId: session.tenantId, entryId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!entry) {
    notFound();
  }

  const canWrite = can(session.role, "data.write");
  const isDraft = entry.status === "draft";
  const banner = bannerFor(query);
  const balanced = entry.totalDebit === entry.totalCredit;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/comptabilite/ecritures"
              aria-label="Revenir aux écritures"
              title="Revenir aux écritures"
              className={ACTION_LINK}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                Écriture comptable
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-medium tracking-tight">
                <span className="font-mono text-xl">{entry.number}</span>
                <EntryStatusBadge status={entry.status} />
                <EntrySourceBadge source={entry.source} />
              </h1>
            </div>
          </div>
          {canWrite && isDraft ? (
            <div className="flex items-center gap-1.5">
              <ValidateEntryButton entryId={entry.id} />
              <DeleteEntryButton entryId={entry.id} number={entry.number} />
            </div>
          ) : null}
        </div>

        {banner ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {banner}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Journal</dt>
            <dd className="mt-1 text-sm font-medium">{entry.journalLabel}</dd>
            <dd className="font-mono text-[10px] text-muted">{entry.journalCode}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Date comptable</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
              {isoDateLabel(entry.entryDate)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Exercice</dt>
            <dd className="mt-1 text-sm font-medium">{entry.fiscalYearLabel}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Référence</dt>
            <dd className="mt-1 font-mono text-sm">{entry.reference ?? "—"}</dd>
          </div>
        </dl>

        <p className="mt-4 flex items-center gap-2 text-[11px] leading-5 text-muted">
          <NotebookPen className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium text-ink">{entry.label}</span>
        </p>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de l&apos;écriture {entry.number}</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={`${TH} w-10 text-right`}>
                    #
                  </th>
                  <th scope="col" className={TH}>
                    Compte
                  </th>
                  <th scope="col" className={TH}>
                    Tiers
                  </th>
                  <th scope="col" className={TH}>
                    Lettrage
                  </th>
                  <th scope="col" className={TH}>
                    Libellé
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Débit
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Crédit
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line) => (
                  <tr key={line.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-right font-mono text-[10px] text-muted tabular-nums">
                      {line.lineNumber}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link
                        href={`/comptabilite/grand-livre?compte=${line.accountId}&exercice=${entry.fiscalYearId}`}
                        aria-label={`Ouvrir le grand livre du compte ${line.accountCode}`}
                        title="Ouvrir le grand livre du compte"
                        className="inline-flex items-center gap-1 hover:text-brand"
                      >
                        <span className="font-mono text-[10px]">{line.accountCode}</span>
                        <ArrowUpRight className="size-3 text-muted" aria-hidden="true" />
                      </Link>
                      <span className="block text-[10px] text-muted">{line.accountLabel}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {line.partnerName ? (
                        <span>{line.partnerName}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {line.letteringCode ? (
                        <span className="rounded-full border border-brand/20 bg-brand-soft px-2 py-0.5 font-mono text-[10px] text-brand-strong">
                          {line.letteringCode}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-muted">{line.label ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {line.debit > 0 ? formatXof(line.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {line.credit > 0 ? formatXof(line.credit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-canvas/40 font-medium">
                  <td className="px-4 py-2.5" colSpan={5}>
                    Totaux
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {formatXof(entry.totalDebit)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {formatXof(entry.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <p className="mt-3 flex items-center gap-2 text-[10px] text-muted">
          {isDraft ? (
            <>
              <NotebookPen className="size-3.5" aria-hidden="true" />
              Brouillon : la validation est définitive. Un brouillon ne peut être corrigé qu&apos;en
              le supprimant.
            </>
          ) : (
            <>
              <Lock className="size-3.5" aria-hidden="true" />
              Écriture validée, immuable. Corrigez-la par une écriture inverse.
            </>
          )}
          <span className={balanced ? "text-brand-strong" : "text-copper"}>
            {balanced ? "Équilibrée" : "Déséquilibrée"}
          </span>
        </p>
      </main>
    </div>
  );
}
