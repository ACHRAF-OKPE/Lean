import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, BookOpenCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { LEDGER_LINE_LIMIT } from "@/modules/accounting/constants";
import { getLedgerReport, listAccounts, listFiscalYears } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Grand livre",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function LedgerPage(props: PageProps<"/comptabilite/grand-livre">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du grand livre…" />}>
      <LedgerContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LedgerContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/grand-livre">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [years, accounts, memberships, query] = await Promise.all([
    listFiscalYears(db, session.tenantId),
    listAccounts(db, { tenantId: session.tenantId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const requestedYear = typeof query.exercice === "string" ? query.exercice : null;
  const selectedYear =
    years.find((year) => year.id === requestedYear) ??
    years.find((year) => year.status === "open") ??
    years[0] ??
    null;
  const requestedAccount = typeof query.compte === "string" ? query.compte : null;
  const selectedAccount = accounts.find((account) => account.id === requestedAccount) ?? null;
  const report =
    selectedAccount && selectedYear
      ? await getLedgerReport(db, {
          tenantId: session.tenantId,
          accountId: selectedAccount.id,
          fiscalYearId: selectedYear.id,
        })
      : null;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Grand livre</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Détail chronologique des écritures validées d&apos;un compte, solde cumulé ligne à ligne.
        </p>

        <form
          method="get"
          className="mt-5 grid gap-3 rounded-xl border border-line bg-panel p-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-end"
        >
          <Field label="Compte" htmlFor="ledger-account" hint="Tous les comptes, actifs ou non.">
            <select
              id="ledger-account"
              name="compte"
              required
              defaultValue={selectedAccount?.id ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un compte
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Exercice" htmlFor="ledger-year">
            <select
              id="ledger-year"
              name="exercice"
              required
              defaultValue={selectedYear?.id ?? ""}
              className={INPUT_CLASS}
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            aria-label="Afficher le grand livre"
            title="Afficher le grand livre"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <BookOpenCheck className="size-4" aria-hidden="true" />
          </button>
        </form>

        {years.length === 0 ? (
          <div className="mt-4 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <BookOpenCheck className="mx-auto size-6 text-brand" aria-hidden="true" />
            <p className="mt-3 text-[11px] leading-5 text-muted">
              Aucun exercice comptable.{" "}
              <Link href="/comptabilite/exercices" className="underline">
                Ouvrez un exercice
              </Link>{" "}
              pour consulter un grand livre.
            </p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <BookOpenCheck className="mx-auto size-6 text-brand" aria-hidden="true" />
            <p className="mt-3 text-[11px] leading-5 text-muted">
              Plan comptable vide.{" "}
              <Link href="/comptabilite/comptes" className="underline">
                Créez ou importez des comptes
              </Link>{" "}
              pour consulter un grand livre.
            </p>
          </div>
        ) : report === null ? (
          <p className="mt-4 rounded-md border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted">
            Choisissez un compte puis affichez son grand livre pour l&apos;exercice sélectionné.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Compte</dt>
                <dd className="mt-1 font-mono text-sm">{report.account.code}</dd>
                <dd className="text-[10px] text-muted">{report.account.label}</dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Exercice</dt>
                <dd className="mt-1 text-sm font-medium">{report.fiscalYear.label}</dd>
                <dd className="font-mono text-[10px] text-muted tabular-nums">
                  {isoDateLabel(report.fiscalYear.startsOn)} —{" "}
                  {isoDateLabel(report.fiscalYear.endsOn)}
                </dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Total débit</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {formatXof(report.totalDebit)}
                </dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Total crédit</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {formatXof(report.totalCredit)}
                </dd>
              </div>
            </dl>

            <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
              {report.lines.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <BookOpenCheck className="mx-auto size-6 text-brand" aria-hidden="true" />
                  <p className="mt-3 text-[11px] leading-5 text-muted">
                    Aucun mouvement validé sur ce compte pour cet exercice.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <caption className="sr-only">
                      Grand livre du compte {report.account.code} pour {report.fiscalYear.label}
                    </caption>
                    <thead>
                      <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                        <th scope="col" className={TH}>
                          Date
                        </th>
                        <th scope="col" className={TH}>
                          Écriture
                        </th>
                        <th scope="col" className={TH}>
                          Libellé
                        </th>
                        <th scope="col" className={TH}>
                          Tiers
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Débit
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Crédit
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Solde
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Ouvrir
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.lines.map((line) => (
                        <tr
                          key={`${line.entryId}-${line.lineNumber}`}
                          className="border-b border-line last:border-b-0"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                            {isoDateLabel(line.entryDate)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                            {line.entryNumber}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block">{line.entryLabel}</span>
                            {line.lineLabel ? (
                              <span className="block text-[10px] text-muted">{line.lineLabel}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-[10px] text-muted">
                            {line.partnerName ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {line.debit > 0 ? formatXof(line.debit) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {line.credit > 0 ? formatXof(line.credit) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {formatXof(Math.abs(line.runningBalance))}{" "}
                            {line.runningBalance === 0 ? "" : line.runningBalance > 0 ? "D" : "C"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/comptabilite/ecritures/${line.entryId}`}
                              aria-label={`Ouvrir l'écriture ${line.entryNumber}`}
                              title="Ouvrir l'écriture"
                              className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                            >
                              <ArrowUpRight className="size-3.5" aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-canvas/40 font-medium">
                        <td className="px-4 py-2.5" colSpan={4}>
                          Solde final
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatXof(report.totalDebit)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatXof(report.totalCredit)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatXof(Math.abs(report.balance))}{" "}
                          {report.balance === 0 ? "" : report.balance > 0 ? "D" : "C"}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            {report.truncated ? (
              <p className="mt-3 text-[10px] text-muted">
                Affichage limité aux {LEDGER_LINE_LIMIT} premiers mouvements : le solde final porte
                sur l&apos;ensemble de l&apos;exercice.
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
