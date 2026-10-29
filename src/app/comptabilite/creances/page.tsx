import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarClock, Download } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { AGING_BUCKETS, AGING_BUCKET_LABELS } from "@/modules/reports/constants";
import { summarizeByCustomer } from "@/modules/reports/calculation";
import { getAgedReceivables } from "@/modules/reports/queries";

export const metadata: Metadata = {
  title: "Balance âgée des créances",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TH = "px-4 py-2.5 font-normal";
const TD = "px-4 py-2.5 whitespace-nowrap tabular-nums";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function ReceivablesPage(props: PageProps<"/comptabilite/creances">) {
  return (
    <Suspense fallback={<LoadingShell label="Calcul de la balance âgée…" />}>
      <ReceivablesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ReceivablesContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/creances">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [memberships, query] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const requested = typeof query.date === "string" ? query.date : "";
  const referenceDate = ISO_DATE.test(requested) ? requested : todayIsoDate();
  const report = await getAgedReceivables(db, {
    tenantId: session.tenantId,
    referenceDate,
  });
  const customers = summarizeByCustomer(report.rows);

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
              <h1 className="text-2xl font-medium tracking-tight">
                Balance âgée des créances clients
              </h1>
            </div>
          </div>
          <a
            href={`/api/rapports/creances?date=${report.referenceDate}`}
            aria-label="Exporter la balance âgée en XLSX"
            title="Exporter la balance âgée en XLSX"
            className={ACTION_LINK}
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Factures validées dont le solde reste dû, classées par ancienneté d&apos;échéance à la
          date de référence. Les brouillons, factures annulées, soldées et trop réglées sont exclus.
        </p>

        <form
          method="get"
          className="mt-5 grid gap-3 rounded-xl border border-line bg-panel p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        >
          <Field
            label="Date de référence"
            htmlFor="creances-date"
            hint="Situation arrêtée à cette date, heure d'Abidjan."
          >
            <input
              id="creances-date"
              type="date"
              name="date"
              required
              defaultValue={report.referenceDate}
              className={INPUT_CLASS}
            />
          </Field>
          <button
            type="submit"
            aria-label="Afficher la balance âgée"
            title="Afficher la balance âgée"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <CalendarClock className="size-4" aria-hidden="true" />
          </button>
        </form>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Créances dues</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{formatXof(report.totalXof)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Dont échu</dt>
            <dd className="mt-1 font-mono text-lg text-copper tabular-nums">
              {formatXof(report.overdueXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Factures ouvertes</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{report.rows.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Situation au</dt>
            <dd className="mt-1 text-sm font-medium">{isoDateLabel(report.referenceDate)}</dd>
          </div>
        </dl>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <CalendarClock className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Détail des factures</h2>
          </div>
          {report.rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarClock className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune créance client ouverte au {isoDateLabel(report.referenceDate)}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Balance âgée des créances clients au {isoDateLabel(report.referenceDate)}
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Client
                    </th>
                    <th scope="col" className={TH}>
                      Facture
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Échéance
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Total
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Payé
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Solde
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Retard
                    </th>
                    <th scope="col" className={TH}>
                      Ancienneté
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{row.customerName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {row.customerCode}
                        </span>
                      </td>
                      <td className={`${TD} font-mono text-[10px]`}>{row.number ?? "—"}</td>
                      <td className={`${TD} text-muted`}>{isoDateLabel(row.invoiceDate)}</td>
                      <td className={`${TD} text-muted`}>{isoDateLabel(row.dueDate)}</td>
                      <td className={`${TD} text-right`}>{formatXof(row.totalXof)}</td>
                      <td className={`${TD} text-right`}>{formatXof(row.paidXof)}</td>
                      <td className={`${TD} text-right font-medium`}>
                        {formatXof(row.balanceXof)}
                      </td>
                      <td className={`${TD} text-right`}>
                        {row.overdueDays > 0 ? `${row.overdueDays} j` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            row.bucket === "not_due"
                              ? "border-line bg-canvas text-muted"
                              : "border-copper/20 bg-copper-soft text-copper"
                          }`}
                        >
                          {AGING_BUCKET_LABELS[row.bucket]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-canvas/40 font-semibold">
                    <td className="px-4 py-2.5" colSpan={6}>
                      Total des créances dues
                    </td>
                    <td className={`${TD} text-right`}>{formatXof(report.totalXof)}</td>
                    <td className={`${TD} text-right`} colSpan={2}>
                      {formatXof(report.overdueXof)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Synthèse par ancienneté</h2>
            </div>
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Somme des soldes par tranche d&apos;ancienneté</caption>
              <tbody>
                {AGING_BUCKETS.map((bucket) => (
                  <tr key={bucket} className="border-b border-line">
                    <th scope="row" className="px-4 py-2.5 font-normal">
                      {AGING_BUCKET_LABELS[bucket]}
                    </th>
                    <td className={`${TD} text-right`}>{formatXof(report.totals[bucket])}</td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-canvas/40 font-semibold">
                  <th scope="row" className="px-4 py-2.5 text-left">
                    Total
                  </th>
                  <td className={`${TD} text-right`}>{formatXof(report.totalXof)}</td>
                </tr>
                <tr className="font-medium">
                  <th scope="row" className="px-4 py-2.5 text-left text-copper">
                    Dont échu
                  </th>
                  <td className={`${TD} text-right text-copper`}>{formatXof(report.overdueXof)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Synthèse par client</h2>
            </div>
            {customers.length === 0 ? (
              <p className="px-5 py-12 text-center text-[11px] leading-5 text-muted">
                Aucun client créancier à cette date.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <caption className="sr-only">
                    Somme des soldes par client et par tranche d&apos;ancienneté
                  </caption>
                  <thead>
                    <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                      <th scope="col" className={TH}>
                        Client
                      </th>
                      {AGING_BUCKETS.map((bucket) => (
                        <th key={bucket} scope="col" className={`${TH} text-right`}>
                          {AGING_BUCKET_LABELS[bucket]}
                        </th>
                      ))}
                      <th scope="col" className={`${TH} text-right`}>
                        Total
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Factures
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.customerCode} className="border-b border-line">
                        <td className="px-4 py-2.5">
                          <span className="block font-medium">{customer.customerName}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {customer.customerCode}
                          </span>
                        </td>
                        {AGING_BUCKETS.map((bucket) => (
                          <td key={bucket} className={`${TD} text-right`}>
                            {customer.totals[bucket] > 0 ? formatXof(customer.totals[bucket]) : "—"}
                          </td>
                        ))}
                        <td className={`${TD} text-right font-medium`}>
                          {formatXof(customer.totalXof)}
                        </td>
                        <td className={`${TD} text-right`}>{customer.invoiceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-canvas/40 font-semibold">
                      <th scope="row" className="px-4 py-2.5 text-left">
                        Total
                      </th>
                      {AGING_BUCKETS.map((bucket) => (
                        <td key={bucket} className={`${TD} text-right`}>
                          {formatXof(report.totals[bucket])}
                        </td>
                      ))}
                      <td className={`${TD} text-right`}>{formatXof(report.totalXof)}</td>
                      <td className={`${TD} text-right`}>{report.rows.length}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
