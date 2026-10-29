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
import { getSupplierCommitments } from "@/modules/reports/queries";

export const metadata: Metadata = {
  title: "Engagements fournisseurs",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TH = "px-4 py-2.5 font-normal";
const TD = "px-4 py-2.5 whitespace-nowrap tabular-nums";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function CommitmentsPage(props: PageProps<"/comptabilite/engagements">) {
  return (
    <Suspense fallback={<LoadingShell label="Calcul des engagements…" />}>
      <CommitmentsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function CommitmentsContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/engagements">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [memberships, query] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const requested = typeof query.date === "string" ? query.date : "";
  const referenceDate = ISO_DATE.test(requested) ? requested : todayIsoDate();
  const report = await getSupplierCommitments(db, {
    tenantId: session.tenantId,
    referenceDate,
  });

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
              <h1 className="text-2xl font-medium tracking-tight">Engagements fournisseurs</h1>
            </div>
          </div>
          <a
            href={`/api/rapports/engagements?date=${report.referenceDate}`}
            aria-label="Exporter les engagements en XLSX"
            title="Exporter les engagements en XLSX"
            className={ACTION_LINK}
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Commandes fournisseur confirmées non entièrement reçues : chaque reliquat est valorisé au
          prix unitaire de la commande. Une commande dont la réception prévue est passée est
          signalée en retard.
        </p>

        <form
          method="get"
          className="mt-5 grid gap-3 rounded-xl border border-line bg-panel p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        >
          <Field
            label="Date de référence"
            htmlFor="engagements-date"
            hint="Situation arrêtée à cette date, heure d'Abidjan."
          >
            <input
              id="engagements-date"
              type="date"
              name="date"
              required
              defaultValue={report.referenceDate}
              className={INPUT_CLASS}
            />
          </Field>
          <button
            type="submit"
            aria-label="Afficher les engagements fournisseurs"
            title="Afficher les engagements fournisseurs"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <CalendarClock className="size-4" aria-hidden="true" />
          </button>
        </form>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Montant engagé</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{formatXof(report.totalXof)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Dont en retard</dt>
            <dd className="mt-1 font-mono text-lg text-copper tabular-nums">
              {formatXof(report.overdueXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Commandes ouvertes</dt>
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
            <h2 className="text-sm font-semibold">Commandes ouvertes</h2>
          </div>
          {report.rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarClock className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun engagement fournisseur ouvert au {isoDateLabel(report.referenceDate)}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Engagements fournisseurs au {isoDateLabel(report.referenceDate)}
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Fournisseur
                    </th>
                    <th scope="col" className={TH}>
                      Commande
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Réception prévue
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Lignes
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Montant
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{row.supplierName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {row.supplierCode}
                        </span>
                      </td>
                      <td className={`${TD} font-mono text-[10px]`}>
                        <Link
                          href={`/achats/${row.id}`}
                          aria-label={`Ouvrir la commande ${row.number ?? row.id}`}
                          title="Ouvrir la commande"
                          className="underline decoration-line underline-offset-4 hover:text-brand"
                        >
                          {row.number ?? "—"}
                        </Link>
                      </td>
                      <td className={`${TD} text-muted`}>{isoDateLabel(row.orderDate)}</td>
                      <td className={`${TD} text-muted`}>
                        {row.expectedReceiptDate ? isoDateLabel(row.expectedReceiptDate) : "—"}
                      </td>
                      <td className={`${TD} text-right`}>{row.lineCount}</td>
                      <td className={`${TD} text-right font-medium`}>{formatXof(row.amountXof)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            row.overdue
                              ? "border-copper/20 bg-copper-soft text-copper"
                              : "border-line bg-canvas text-muted"
                          }`}
                        >
                          {row.overdue ? "En retard" : "À venir"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-canvas/40 font-semibold">
                    <td className="px-4 py-2.5" colSpan={5}>
                      Total engagé
                    </td>
                    <td className={`${TD} text-right`}>{formatXof(report.totalXof)}</td>
                    <td className={`${TD} text-right`}>{formatXof(report.overdueXof)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Synthèse</h2>
          </div>
          <table className="w-full text-left text-[11px]">
            <caption className="sr-only">Synthèse des engagements fournisseurs</caption>
            <tbody>
              <tr className="border-b border-line">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  Montant engagé
                </th>
                <td className={`${TD} text-right`}>{formatXof(report.totalXof)}</td>
              </tr>
              <tr className="font-medium text-copper">
                <th scope="row" className="px-4 py-2.5 text-left">
                  Dont en retard de réception
                </th>
                <td className={`${TD} text-right`}>{formatXof(report.overdueXof)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
