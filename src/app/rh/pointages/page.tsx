import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Filter, Fingerprint, Plus, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { TimeEntryStatusBadge } from "@/components/hr-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import type { HrTimeEntryKind, HrTimeEntryPeriod, HrTimeEntryStatus } from "@/db/schema";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_LIST_LIMIT,
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
  HR_TIME_ENTRY_STATUSES,
  HR_TIME_ENTRY_STATUS_LABELS,
  isHrTimeEntryStatus,
} from "@/modules/hr/constants";
import { listEmployees } from "@/modules/hr/queries";
import { entryHalfDays, formatHalfDays, formatHours } from "@/modules/hr/time";
import { getTimeEntryCounters, listTimeEntries } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Pointages",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const SMALL_LINK =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** La borne haute des filtres est exclusive côté requête : on la pousse au lendemain du jour choisi. */
function nextIsoDay(isoDate: string): string {
  const next = new Date(`${isoDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export default function TimeEntriesPage(props: PageProps<"/rh/pointages">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des pointages…" />}>
      <TimeEntriesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TimeEntriesContent({
  searchParams,
}: Pick<PageProps<"/rh/pointages">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const canWrite = await canAccessModule(session, "hr", "write");
  const today = todayIsoDate();
  const query = await searchParams;

  const employeeFilter = first(query.salarie);
  const statusFilter = first(query.statut);
  const fromFilter = first(query.du);
  const toFilter = first(query.au);
  const searchFilter = first(query.recherche).trim();

  const [memberships, employees, counters] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    getTimeEntryCounters(db, session.tenantId, today),
  ]);

  const salarie = employees.some((employee) => employee.id === employeeFilter)
    ? employeeFilter
    : null;
  const statut: HrTimeEntryStatus | null = isHrTimeEntryStatus(statusFilter) ? statusFilter : null;
  const du = ISO_DATE_PATTERN.test(fromFilter) && fromFilter <= today ? fromFilter : null;
  const au = ISO_DATE_PATTERN.test(toFilter) && toFilter <= today ? toFilter : null;

  const entries = await listTimeEntries(db, {
    tenantId: session.tenantId,
    employeeId: salarie,
    status: statut,
    from: du,
    to: au ? nextIsoDay(au) : null,
    search: searchFilter || null,
    limit: HR_LIST_LIMIT,
  });

  const hasFilters = Boolean(salarie || statut || du || au || searchFilter);
  const removed = typeof query.supprime === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Temps de travail
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Pointages</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Chaque ligne constate une demi-journée, une journée ou des heures travaillées, ou une
              absence motivée. Une ligne naît en brouillon et ne porte qu&apos;une seule fois la
              même période du même jour ; sa validation, son retour au brouillon et sa suppression
              relèvent de la gestion.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {canWrite ? (
              <>
                <Link
                  href="/rh/pointages/nouveau"
                  aria-label="Nouvelle ligue"
                  title="Nouvelle ligue de pointage"
                  className={ACTION_LINK}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Link>
                <CatalogActions kind="hr_time_entries" canDraft={canWrite} />
              </>
            ) : null}
          </div>
        </div>

        {removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Ligue de pointage supprimée.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Brouillons</dt>
            <dd
              className={`mt-1 font-mono text-2xl tabular-nums ${
                counters.drafts > 0 ? "text-copper" : ""
              }`}
            >
              {counters.drafts}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Validés ce mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.validatedThisMonth}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Absences ce mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.absencesThisMonth}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Heures travaillées ce mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {formatHours(counters.workedHoursThisMonth)}
            </dd>
          </div>
        </dl>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <Filter className="size-3.5 self-center text-muted" aria-hidden="true" />
          <label className="text-[10px] text-muted">
            Salarié
            <select name="salarie" defaultValue={salarie ?? ""} className={`${CONTROL} w-56`}>
              <option value="">Tous</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Statut
            <select name="statut" defaultValue={statut ?? ""} className={CONTROL}>
              <option value="">Tous</option>
              {HR_TIME_ENTRY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HR_TIME_ENTRY_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Du
            <input type="date" name="du" defaultValue={du ?? ""} max={today} className={CONTROL} />
          </label>
          <label className="text-[10px] text-muted">
            Au
            <input type="date" name="au" defaultValue={au ?? ""} max={today} className={CONTROL} />
          </label>
          <label className="text-[10px] text-muted">
            Recherche
            <input
              type="search"
              name="recherche"
              defaultValue={searchFilter}
              placeholder="Matricule ou nom"
              className={`${CONTROL} w-44`}
            />
          </label>
          <button
            type="submit"
            aria-label="Filtrer les pointages"
            title="Filtrer les pointages"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {hasFilters ? (
            <Link
              href="/rh/pointages"
              aria-label="Réinitialiser les filtres"
              title="Réinitialiser les filtres"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <X className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </form>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Fingerprint className="size-4 text-brand" aria-hidden="true" />
              Ligues de pointage
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {entries.length} ligne{entries.length > 1 ? "s" : ""}
              {hasFilters ? " correspondant aux filtres" : ""}
            </p>
          </div>
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Fingerprint className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                {hasFilters
                  ? "Aucune ligue ne correspond à ces filtres."
                  : "Aucune ligue de pointage. Ajoutez-en une, ou importez les pointages depuis le modèle XLSX."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Ligues de pointage de l&apos;espace, du jour le plus récent au plus ancien
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Salarié
                    </th>
                    <th scope="col" className={TH}>
                      Nature
                    </th>
                    <th scope="col" className={TH}>
                      Période
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Demi-journées
                    </th>
                    <th scope="col" className={TH}>
                      Motif
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
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="whitespace-nowrap tabular-nums">
                            {isoDateLabel(entry.workDate)}
                          </span>
                          {canWrite ? (
                            <Link
                              href={`/rh/pointages/nouveau?salarie=${entry.employeeId}&date=${entry.workDate}`}
                              aria-label={`Nouvelle ligue pour ${entry.employeeName} le ${entry.workDate}`}
                              title="Nouvelle ligue pour ce salarié et ce jour"
                              className={SMALL_LINK}
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                            </Link>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{entry.employeeName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {entry.employeeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {HR_TIME_ENTRY_KIND_LABELS[entry.kind as HrTimeEntryKind]}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {HR_TIME_ENTRY_PERIOD_LABELS[entry.period as HrTimeEntryPeriod]}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {entry.period === "hours"
                          ? `${formatHours(Number(entry.hours ?? 0))} h`
                          : formatHalfDays(entryHalfDays(entry.period as HrTimeEntryPeriod))}
                      </td>
                      <td className="px-4 py-2.5 break-words text-muted">{entry.note ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <TimeEntryStatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/pointages/${entry.id}`}
                          aria-label={`Ouvrir le pointage de ${entry.employeeName} du ${entry.workDate}`}
                          title="Ouvrir la ligue"
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

        <p className="mt-3 text-[10px] leading-4 text-muted tabular-nums">
          {formatHalfDays(counters.workedHalfDaysThisMonth)} demi-journée(s) travaillée(s) ce mois,
          {counters.employeesPunchedThisMonth} salarié(s) pointé(s)
          {entries.length === HR_LIST_LIMIT
            ? ` — lecture des ${HR_LIST_LIMIT} ligues les plus récentes : affinez les filtres pour descendre plus bas.`
            : "."}
        </p>
      </main>
    </div>
  );
}
