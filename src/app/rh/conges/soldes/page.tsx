import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Filter, Scale, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getLeaveBalances } from "@/modules/hr/leave-queries";

export const metadata: Metadata = {
  title: "Soldes de congés",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function days(value: number): string {
  return `${value}`.replace(".", ",");
}

export default function LeaveBalancesPage(props: PageProps<"/rh/conges/soldes">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des soldes…" />}>
      <LeaveBalancesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeaveBalancesContent({
  searchParams,
}: Pick<PageProps<"/rh/conges/soldes">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const today = todayIsoDate();
  const thisYear = Number(today.slice(0, 4));
  const query = await searchParams;
  const yearFilter = Number(first(query.annee)) || thisYear;

  const [balances, memberships] = await Promise.all([
    getLeaveBalances(db, session.tenantId, { year: yearFilter }),
    listMembershipsForUser(db, session.userId),
  ]);

  const yearOptions = [...new Set([thisYear, yearFilter, thisYear - 1, thisYear - 2])].sort(
    (a, b) => b - a,
  );
  const overDrawn = balances.filter((row) => row.availableDays < 0).length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-start gap-3">
          <Link
            href="/rh/conges"
            aria-label="Revenir aux congés"
            title="Revenir aux congés"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Congés</p>
            <h1 className="text-2xl font-medium tracking-tight">Soldes</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Le droit annuel du type moins les jours posés : les jours validés comptent comme
              acquis, les brouillons restent en attente. Les jours posés se mesurent sur le
              calendrier du salarié, comme la déduction d&apos;un congé validé.
            </p>
          </div>
        </div>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <Filter className="size-3.5 self-center text-muted" aria-hidden="true" />
          <label className="text-[10px] text-muted">
            Année
            <select name="annee" defaultValue={String(yearFilter)} className={CONTROL}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-label="Filtrer les soldes"
            title="Filtrer les soldes"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {yearFilter !== thisYear ? (
            <Link
              href="/rh/conges/soldes"
              aria-label="Revenir à l'année courante"
              title="Revenir à l'année courante"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <X className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </form>

        {overDrawn > 0 ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            {overDrawn} solde{overDrawn > 1 ? "s" : ""} au-delà du droit annuel sur {yearFilter} :
            les jours posés dépassent le droit accordé.
          </p>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Scale className="size-4 text-brand" aria-hidden="true" />
              {yearFilter}
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {balances.length} ligne{balances.length > 1 ? "s" : ""}
            </p>
          </div>
          {balances.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Scale className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun solde à afficher pour {yearFilter}. Un solde apparaît dès qu&apos;un type
                porte un droit annuel ou qu&apos;une demande est posée.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Soldes de congés de {yearFilter}, par salarié et par type
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Salarié
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Droit annuel
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Validés
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      En attente
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Reste
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((row) => (
                    <tr
                      key={`${row.employeeId}|${row.leaveTypeId}`}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{row.employeeName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {row.employeeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block">{row.leaveTypeName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {row.leaveTypeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {days(row.allowanceDays)} j
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {days(row.takenDays)} j
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {row.pendingDays > 0 ? (
                          <span className="text-copper">{days(row.pendingDays)} j</span>
                        ) : (
                          <span className="text-muted">0 j</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right whitespace-nowrap tabular-nums ${
                          row.availableDays < 0 ? "text-copper" : ""
                        }`}
                      >
                        {days(row.availableDays)} j
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
