import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CalendarCheck, Filter, Plus, Scale, Settings2, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LeaveStatusBadge } from "@/components/hr-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_LEAVE_HALF_DAY_LABELS,
  HR_LEAVE_REQUEST_STATUSES,
  HR_LEAVE_REQUEST_STATUS_LABELS,
  HR_LIST_LIMIT,
  isHrLeaveRequestStatus,
} from "@/modules/hr/constants";
import {
  getLeaveCounters,
  leaveRequestTotalsBatch,
  listLeaveRequests,
  listLeaveTypes,
} from "@/modules/hr/leave-queries";
import { listEmployees } from "@/modules/hr/queries";
import { formatHalfDays, formatHours } from "@/modules/hr/time";

export const metadata: Metadata = {
  title: "Congés",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const OPEN_LINK =
  "ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function LeaveRequestsPage(props: PageProps<"/rh/conges">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des congés…" />}>
      <LeaveRequestsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeaveRequestsContent({
  searchParams,
}: Pick<PageProps<"/rh/conges">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const today = todayIsoDate();
  const thisYear = Number(today.slice(0, 4));
  const query = await searchParams;

  // HR-016 — la liste se lit, la saisie demande écriture et la décision gestion.
  const canWrite = await canAccessModule(session, "hr", "write");

  const yearFilter = Number(first(query.annee)) || thisYear;
  const statusFilter = isHrLeaveRequestStatus(first(query.statut))
    ? (first(query.statut) as (typeof HR_LEAVE_REQUEST_STATUSES)[number])
    : undefined;
  const employeeFilter = first(query.salarie);
  const typeFilter = first(query.type);

  const [memberships, counters, employees, types, requests] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    getLeaveCounters(db, session.tenantId, today),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listLeaveTypes(db, session.tenantId),
    listLeaveRequests(db, session.tenantId, {
      year: yearFilter,
      status: statusFilter,
      employeeId: employeeFilter || undefined,
      leaveTypeId: typeFilter || undefined,
    }),
  ]);

  const totals = await leaveRequestTotalsBatch(db, session.tenantId, requests);

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const removed = typeof query.supprime === "string";
  const yearOptions = [...new Set([thisYear, yearFilter, thisYear - 1, thisYear - 2])].sort(
    (a, b) => b - a,
  );
  const filtered = Boolean(employeeFilter || typeFilter || statusFilter);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ressources humaines
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Congés</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Une demande de congé se pose en demi-journées : elle démarre le matin ou
              l&apos;après-midi du premier jour et se termine le matin ou l&apos;après-midi du
              dernier. Elle naît en brouillon ; validée, elle retire du travail attendu exactement
              ce que le calendrier du salarié prévoyait, comme un jour férié. Le solde suit la même
              mesure.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {canWrite ? (
              <Link
                href="/rh/conges/nouvelle"
                aria-label="Nouvelle demande de congé"
                title="Nouvelle demande de congé"
                className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
              >
                <Plus className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
            <Link
              href="/rh/conges/soldes"
              aria-label="Soldes de congés"
              title="Soldes de congés"
              className={ACTION_LINK}
            >
              <Scale className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/rh/conges/types"
              aria-label="Types de congé"
              title="Types de congé"
              className={ACTION_LINK}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Demandes en brouillon</dt>
            <dd
              className={`mt-1 font-mono text-2xl tabular-nums ${
                counters.drafts > 0 ? "text-copper" : ""
              }`}
            >
              {counters.drafts}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Validées en {thisYear}</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.validatedThisYear}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Absents aujourd&apos;hui</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.awayToday}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Types actifs</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {counters.activeTypes}
              <span className="text-sm text-muted"> / {counters.types}</span>
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[10px] leading-4 text-muted tabular-nums">
          {counters.refusedThisYear} refusée(s) et {counters.cancelledThisYear} annulée(s) en{" "}
          {thisYear}. Une demande validée couvre des demi-journées déjà retirées du travail attendu
          : la comptabiliser sur une demande qui se recouvre est refusé.
        </p>

        {created || updated || removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created
              ? "Demande de congé enregistrée en brouillon."
              : updated
                ? "Demande de congé mise à jour."
                : "Demande de congé supprimée."}
          </p>
        ) : null}

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
          <label className="text-[10px] text-muted">
            Statut
            <select name="statut" defaultValue={statusFilter ?? ""} className={CONTROL}>
              <option value="">Tous</option>
              {HR_LEAVE_REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HR_LEAVE_REQUEST_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Salarié
            <select name="salarie" defaultValue={employeeFilter} className={CONTROL}>
              <option value="">Tous</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.code} · {employee.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Type
            <select name="type" defaultValue={typeFilter} className={CONTROL}>
              <option value="">Tous</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} · {type.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-label="Filtrer les congés"
            title="Filtrer les congés"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {filtered ? (
            <Link
              href={`/rh/conges?annee=${yearFilter}`}
              aria-label="Retirer les filtres"
              title="Retirer les filtres"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <X className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </form>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarCheck className="size-4 text-brand" aria-hidden="true" />
              {yearFilter}
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {requests.length} demande{requests.length > 1 ? "s" : ""}
            </p>
          </div>
          {requests.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarCheck className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune demande de congé sur {yearFilter}
                {filtered ? " pour ces filtres" : ""}. Le travail attendu suit alors le calendrier
                et les jours fériés, sans retrait de congé.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Demandes de congé de {yearFilter}, de la plus récente à la plus ancienne
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Salarié
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Période
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Déduit
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
                  {requests.map((request) => {
                    const total = totals.get(request.id);
                    return (
                      <tr key={request.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5">
                          <span className="block font-medium">{request.employeeName}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {request.employeeCode}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="block">{request.leaveTypeName}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {request.leaveTypeCode}
                            {request.leaveTypePaid ? "" : " · non payé"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="block text-muted">
                            Du {isoDateLabel(request.startDate)} ·{" "}
                            {HR_LEAVE_HALF_DAY_LABELS[request.startHalfDay]}
                          </span>
                          <span className="block text-muted">
                            Au {isoDateLabel(request.endDate)} ·{" "}
                            {HR_LEAVE_HALF_DAY_LABELS[request.endHalfDay]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {total && total.halfDays > 0 ? (
                            <>
                              <span className="block">
                                {formatHalfDays(total.halfDays)} demi-j.
                              </span>
                              <span className="block text-[10px] text-muted">
                                {formatHours(total.hours)} h sur {total.days} jour
                                {total.days > 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">Aucun jour ouvré</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <LeaveStatusBadge status={request.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/rh/conges/${request.id}`}
                            aria-label={`Ouvrir la demande de ${request.employeeName}`}
                            title="Ouvrir la demande"
                            className={OPEN_LINK}
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
