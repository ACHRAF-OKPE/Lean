import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Scale } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getBalanceReport, listFiscalYears } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Balance générale",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function BalancePage(props: PageProps<"/comptabilite/balance">) {
  return (
    <Suspense fallback={<LoadingShell label="Calcul de la balance…" />}>
      <BalanceContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function BalanceContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/balance">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [years, memberships, query] = await Promise.all([
    listFiscalYears(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const requested = typeof query.exercice === "string" ? query.exercice : null;
  const selected =
    years.find((year) => year.id === requested) ??
    years.find((year) => year.status === "open") ??
    years[0] ??
    null;
  const report = selected
    ? await getBalanceReport(db, { tenantId: session.tenantId, fiscalYearId: selected.id })
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
            <h1 className="text-2xl font-medium tracking-tight">Balance générale</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Soldes par compte calculés sur les écritures validées de l&apos;exercice. Le total des
          débits égale le total des crédits.
        </p>

        {years.length === 0 ? (
          <div className="mt-5 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <Scale className="mx-auto size-6 text-brand" aria-hidden="true" />
            <p className="mt-3 text-[11px] leading-5 text-muted">
              Aucun exercice comptable.{" "}
              <Link href="/comptabilite/exercices" className="underline">
                Ouvrez un exercice
              </Link>{" "}
              pour alimenter la balance.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {years.map((year) => {
                const active = year.id === selected?.id;
                return (
                  <Link
                    key={year.id}
                    href={`/comptabilite/balance?exercice=${year.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
                      active
                        ? "border-brand/20 bg-brand-soft text-brand-strong"
                        : "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand"
                    }`}
                  >
                    {year.label}
                  </Link>
                );
              })}
            </div>

            {report ? (
              <>
                <dl className="mt-4 grid gap-2 sm:grid-cols-3">
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
                  <div className="rounded-lg border border-line bg-panel px-4 py-3">
                    <dt className="text-[10px] text-muted">Exercice</dt>
                    <dd className="mt-1 text-sm font-medium">{report.fiscalYear.label}</dd>
                    <dd className="font-mono text-[10px] text-muted tabular-nums">
                      {isoDateLabel(report.fiscalYear.startsOn)} —{" "}
                      {isoDateLabel(report.fiscalYear.endsOn)}
                    </dd>
                  </div>
                </dl>

                <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
                  {report.rows.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                      <Scale className="mx-auto size-6 text-brand" aria-hidden="true" />
                      <p className="mt-3 text-[11px] leading-5 text-muted">
                        Aucune écriture validée sur cet exercice : la balance est vide.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <caption className="sr-only">
                          Balance générale de l&apos;exercice {report.fiscalYear.label}
                        </caption>
                        <thead>
                          <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                            <th scope="col" className={`${TH} w-10 text-right`}>
                              Cl.
                            </th>
                            <th scope="col" className={TH}>
                              Compte
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
                            <th scope="col" className={`${TH} text-right`}>
                              Solde
                            </th>
                            <th scope="col" className={`${TH} text-right`}>
                              Grand livre
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.map((row) => (
                            <tr
                              key={row.accountId}
                              className="border-b border-line last:border-b-0"
                            >
                              <td className="px-4 py-2.5 text-right font-mono text-[10px] text-muted tabular-nums">
                                {row.accountClass}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                                {row.code}
                              </td>
                              <td className="px-4 py-2.5">{row.label}</td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {row.debit > 0 ? formatXof(row.debit) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {row.credit > 0 ? formatXof(row.credit) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {row.balance === 0
                                  ? "—"
                                  : `${formatXof(Math.abs(row.balance))} ${row.balance > 0 ? "D" : "C"}`}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <Link
                                  href={`/comptabilite/grand-livre?compte=${row.accountId}&exercice=${report.fiscalYear.id}`}
                                  aria-label={`Ouvrir le grand livre du compte ${row.code}`}
                                  title="Ouvrir le grand livre"
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
                            <td className="px-4 py-2.5" colSpan={3}>
                              Totaux
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                              {formatXof(report.totalDebit)}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                              {formatXof(report.totalCredit)}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                              {formatXof(report.totalDebit - report.totalCredit)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
