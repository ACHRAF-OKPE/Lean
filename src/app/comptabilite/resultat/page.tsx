import type { Metadata } from "next";
import { Fragment, Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Download, Scale } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listFiscalYears } from "@/modules/accounting/queries";
import { INCOME_STATEMENT_SECTIONS } from "@/modules/reports/constants";
import { getIncomeStatement } from "@/modules/reports/queries";

export const metadata: Metadata = {
  title: "Compte de résultat",
};

const TH = "px-4 py-2.5 font-normal";
const TD = "px-4 py-2.5 whitespace-nowrap tabular-nums";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function IncomeStatementPage(props: PageProps<"/comptabilite/resultat">) {
  return (
    <Suspense fallback={<LoadingShell label="Calcul du compte de résultat…" />}>
      <IncomeStatementContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function IncomeStatementContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/resultat">, "searchParams">) {
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
    ? await getIncomeStatement(db, { tenantId: session.tenantId, fiscalYearId: selected.id })
    : null;

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
                Rapports
              </p>
              <h1 className="text-2xl font-medium tracking-tight">Compte de résultat</h1>
            </div>
          </div>
          {report ? (
            <a
              href={`/api/rapports/resultat?exercice=${report.fiscalYear.id}`}
              aria-label="Exporter le compte de résultat en XLSX"
              title="Exporter le compte de résultat en XLSX"
              className={ACTION_LINK}
            >
              <Download className="size-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Charges, produits et hors activité ordinaire calculés à la lecture sur les écritures
          validées de l&apos;exercice. Le résultat net est produits moins charges ; la somme des
          soldes des classes 1 à 5 doit égaler son opposé.
        </p>

        {years.length === 0 ? (
          <div className="mt-5 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <Scale className="mx-auto size-6 text-brand" aria-hidden="true" />
            <p className="mt-3 text-[11px] leading-5 text-muted">
              Aucun exercice comptable.{" "}
              <Link href="/comptabilite/exercices" className="underline">
                Ouvrez un exercice
              </Link>{" "}
              pour établir le compte de résultat.
            </p>
          </div>
        ) : (
          <>
            <form
              method="get"
              className="mt-5 grid gap-3 rounded-xl border border-line bg-panel p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
            >
              <Field label="Exercice" htmlFor="resultat-year" hint="Exercice comptable soldé.">
                <select
                  id="resultat-year"
                  name="exercice"
                  required
                  defaultValue={selected?.id ?? ""}
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
                aria-label="Afficher le compte de résultat"
                title="Afficher le compte de résultat"
                className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
              >
                <Scale className="size-4" aria-hidden="true" />
              </button>
            </form>

            {report ? (
              <>
                <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-line bg-panel px-4 py-3">
                    <dt className="text-[10px] text-muted">Total charges</dt>
                    <dd className="mt-1 font-mono text-lg tabular-nums">
                      {formatXof(report.charges)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-line bg-panel px-4 py-3">
                    <dt className="text-[10px] text-muted">Total produits</dt>
                    <dd className="mt-1 font-mono text-lg tabular-nums">
                      {formatXof(report.produits)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-line bg-panel px-4 py-3">
                    <dt className="text-[10px] text-muted">Résultat net</dt>
                    <dd
                      className={`mt-1 font-mono text-lg tabular-nums ${
                        report.result > 0
                          ? "text-brand-strong"
                          : report.result < 0
                            ? "text-copper"
                            : ""
                      }`}
                    >
                      {formatXof(report.result)}
                    </dd>
                    <dd className="text-[10px] text-muted">
                      {report.result > 0
                        ? "Bénéfice"
                        : report.result < 0
                          ? "Perte"
                          : "À l'équilibre"}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-line bg-panel px-4 py-3">
                    <dt className="text-[10px] text-muted">Classes 1 à 5</dt>
                    <dd className="mt-1 font-mono text-lg tabular-nums">
                      {formatXof(report.balanceSheetBalance)}
                    </dd>
                    <dd className="text-[10px] text-muted">
                      Doit égaler l&apos;opposé du résultat
                    </dd>
                  </div>
                </dl>

                <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                    <Scale className="size-4 text-brand" aria-hidden="true" />
                    <h2 className="text-sm font-semibold">{report.fiscalYear.label}</h2>
                    <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
                      {isoDateLabel(report.fiscalYear.startsOn)} —{" "}
                      {isoDateLabel(report.fiscalYear.endsOn)}
                    </span>
                  </div>
                  {report.rows.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                      <Scale className="mx-auto size-6 text-brand" aria-hidden="true" />
                      <p className="mt-3 text-[11px] leading-5 text-muted">
                        Aucune charge ni produit sur cet exercice : le compte de résultat est vide.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <caption className="sr-only">
                          Compte de résultat de {report.fiscalYear.label}
                        </caption>
                        <thead>
                          <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
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
                              Charges
                            </th>
                            <th scope="col" className={`${TH} text-right`}>
                              Produits
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {INCOME_STATEMENT_SECTIONS.map((section) => {
                            const rows = report.rows.filter(
                              (row) => row.accountClass === section.accountClass,
                            );
                            if (rows.length === 0) {
                              return null;
                            }
                            return (
                              <Fragment key={section.label}>
                                <tr className="bg-canvas/40">
                                  <th
                                    scope="colgroup"
                                    colSpan={6}
                                    className="px-4 py-2 text-left font-mono text-[10px] tracking-[0.12em] text-brand-strong uppercase"
                                  >
                                    {section.label}
                                  </th>
                                </tr>
                                {rows.map((row) => (
                                  <tr key={row.accountId} className="border-b border-line">
                                    <td className={`${TD} font-mono text-[10px]`}>{row.code}</td>
                                    <td className="px-4 py-2.5">{row.label}</td>
                                    <td className={`${TD} text-right`}>
                                      {row.debit > 0 ? formatXof(row.debit) : "—"}
                                    </td>
                                    <td className={`${TD} text-right`}>
                                      {row.credit > 0 ? formatXof(row.credit) : "—"}
                                    </td>
                                    <td className={`${TD} text-right`}>
                                      {row.chargeXof !== 0 ? formatXof(row.chargeXof) : "—"}
                                    </td>
                                    <td className={`${TD} text-right`}>
                                      {row.produitXof !== 0 ? formatXof(row.produitXof) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-line font-medium">
                            <td className="px-4 py-2.5" colSpan={4}>
                              Total charges
                            </td>
                            <td className={`${TD} text-right`}>{formatXof(report.charges)}</td>
                            <td />
                          </tr>
                          <tr className="border-t border-line font-medium">
                            <td className="px-4 py-2.5" colSpan={5}>
                              Total produits
                            </td>
                            <td className={`${TD} text-right`}>{formatXof(report.produits)}</td>
                          </tr>
                          <tr className="border-t border-line bg-canvas/40 font-semibold">
                            <td className="px-4 py-2.5" colSpan={4}>
                              {report.result > 0
                                ? "Résultat net : bénéfice"
                                : report.result < 0
                                  ? "Résultat net : perte"
                                  : "Résultat net : à l'équilibre"}
                            </td>
                            <td className={`${TD} text-right`}>
                              {report.result >= 0 ? "" : formatXof(-report.result)}
                            </td>
                            <td className={`${TD} text-right`}>
                              {report.result >= 0 ? formatXof(report.result) : ""}
                            </td>
                          </tr>
                          <tr className="border-t border-line text-muted">
                            <td className="px-4 py-2.5">Contrôle bilan</td>
                            <td className="px-4 py-2.5" colSpan={3}>
                              <span className="text-[10px]">
                                Somme des soldes des classes 1 à 5, à comparer à l&apos;opposé du
                                résultat.
                              </span>
                            </td>
                            <td className={`${TD} text-right`} colSpan={2}>
                              {formatXof(report.balanceSheetBalance)}
                            </td>
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
