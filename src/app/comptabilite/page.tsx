import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowUpRight,
  BookMarked,
  BookOpenCheck,
  CalendarRange,
  GitCompareArrows,
  Handshake,
  ListTree,
  NotebookPen,
  Scale,
  Settings2,
} from "lucide-react";
import { EntryStatusBadge } from "@/components/accounting-badges";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { getAccountingOverview, listJournalEntries } from "@/modules/accounting/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Comptabilité",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const SECTIONS = [
  { href: "/comptabilite/exercices", label: "Exercices comptables", icon: CalendarRange },
  { href: "/comptabilite/comptes", label: "Plan comptable", icon: ListTree },
  { href: "/comptabilite/journaux", label: "Journaux", icon: BookMarked },
  { href: "/comptabilite/ecritures", label: "Écritures", icon: NotebookPen },
  { href: "/comptabilite/balance", label: "Balance générale", icon: Scale },
  { href: "/comptabilite/grand-livre", label: "Grand livre", icon: BookOpenCheck },
  { href: "/comptabilite/lettrage", label: "Lettrage", icon: Handshake },
  {
    href: "/comptabilite/rapprochement",
    label: "Rapprochement de cut-off",
    icon: GitCompareArrows,
  },
  { href: "/comptabilite/parametres", label: "Paramètres comptables", icon: Settings2 },
] as const;

export default function AccountingPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la comptabilité…" />}>
      <AccountingContent />
    </Suspense>
  );
}

async function AccountingContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [overview, entries, memberships] = await Promise.all([
    getAccountingOverview(db, session.tenantId),
    listJournalEntries(db, { tenantId: session.tenantId, limit: 10 }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Comptabilité
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Comptabilité SYSCOHADA</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Plan comptable, journaux, exercices et écritures. Une écriture naît en brouillon puis
              se valide ; seules les écritures validées alimentent la balance et le grand livre.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-label={section.label}
                  title={section.label}
                  className={ACTION_LINK}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </Link>
              );
            })}
            <CatalogActions kind="journal_entries" />
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Comptes</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.accountCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Journaux</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.journalCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Brouillons</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">
              {overview.draftCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Écritures validées</dt>
            <dd className="mt-1 font-mono text-2xl text-brand tabular-nums">
              {overview.validatedCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Exercice ouvert</dt>
            <dd className="mt-1 text-sm font-medium">
              {overview.openFiscalYear ? overview.openFiscalYear.label : "Aucun"}
            </dd>
            {overview.openFiscalYear ? (
              <dd className="mt-0.5 font-mono text-[10px] text-muted tabular-nums">
                {isoDateLabel(overview.openFiscalYear.startsOn)} —{" "}
                {isoDateLabel(overview.openFiscalYear.endsOn)}
              </dd>
            ) : (
              <dd className="mt-0.5 text-[10px] text-muted">
                Créez un exercice pour saisir des écritures.
              </dd>
            )}
          </div>
        </dl>

        {overview.openFiscalYear === null ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Aucun exercice ouvert : la saisie et l&apos;import d&apos;écritures resteront bloqués.
            Ouvrez un exercice dans{" "}
            <Link href="/comptabilite/exercices" className="underline">
              Exercices comptables
            </Link>
            .
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Dernières écritures</h2>
            <Link
              href="/comptabilite/ecritures"
              aria-label="Ouvrir toutes les écritures"
              title="Toutes les écritures"
              className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <NotebookPen className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune écriture dans cet espace. Saisissez-la manuellement ou importez-la depuis le
                modèle XLSX.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Dernières écritures comptables de l&apos;espace
                </caption>
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
                        <span className="font-mono text-[10px]">{entry.journalCode}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{entry.label}</span>
                        {entry.reference ? (
                          <span className="block font-mono text-[10px] text-muted">
                            {entry.reference}
                          </span>
                        ) : null}
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
      </main>
    </div>
  );
}
