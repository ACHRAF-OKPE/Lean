import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CalendarCheck, Scale } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LeaveStatusBadge } from "@/components/hr-badges";
import {
  CancelLeaveRequestButton,
  DeleteLeaveRequestButton,
  LeaveRequestForm,
  RefuseLeaveRequestForm,
  ValidateLeaveRequestButton,
} from "@/components/hr-leave-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LEAVE_HALF_DAY_LABELS, HR_LIST_LIMIT } from "@/modules/hr/constants";
import { getLeaveRequest, leaveRequestTotalsFor, listLeaveTypes } from "@/modules/hr/leave-queries";
import { listEmployees } from "@/modules/hr/queries";
import { formatHalfDays, formatHours } from "@/modules/hr/time";

export const metadata: Metadata = {
  title: "Demande de congé",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const LABEL = "font-mono text-[10px] tracking-[0.12em] text-muted uppercase";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function LeaveRequestPage(props: PageProps<"/rh/conges/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la demande…" />}>
      <LeaveRequestContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeaveRequestContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/conges/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [request, canWrite, canManage] = await Promise.all([
    getLeaveRequest(db, session.tenantId, id),
    canAccessModule(session, "hr", "write"),
    canAccessModule(session, "hr", "manage"),
  ]);
  if (!request) {
    notFound();
  }

  const [memberships, totals, employees, types] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    leaveRequestTotalsFor(db, session.tenantId, request),
    request.status === "draft" && canWrite
      ? listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT })
      : Promise.resolve(null),
    request.status === "draft" && canWrite
      ? listLeaveTypes(db, session.tenantId, { activeOnly: true })
      : Promise.resolve(null),
  ]);

  const query = await searchParams;
  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const reference = `${request.employeeName} · ${isoDateLabel(request.startDate)}`;
  const draft = request.status === "draft";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href={`/rh/conges?annee=${request.startDate.slice(0, 4)}&salarie=${request.employeeId}`}
            aria-label="Revenir aux congés"
            title="Revenir aux congés"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Demande de congé
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {request.employeeName}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
              <span>{request.employeeCode}</span>
              <span>·</span>
              <span>
                {request.leaveTypeName} ({request.leaveTypeCode})
              </span>
              <LeaveStatusBadge status={request.status} />
            </p>
          </div>
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created
              ? "Demande de congé enregistrée en brouillon."
              : "Demande de congé mise à jour."}
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarCheck className="size-4 text-brand" aria-hidden="true" />
              Période et déduction
            </h2>
            <Link
              href={`/rh/conges/soldes?annee=${request.startDate.slice(0, 4)}`}
              aria-label="Voir les soldes de congés"
              title="Voir les soldes"
              className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <Scale className="size-3.5" aria-hidden="true" />
            </Link>
          </div>

          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div>
              <dt className={LABEL}>Début</dt>
              <dd className="mt-1 text-[11px]">
                {isoDateLabel(request.startDate)} · {HR_LEAVE_HALF_DAY_LABELS[request.startHalfDay]}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Fin</dt>
              <dd className="mt-1 text-[11px]">
                {isoDateLabel(request.endDate)} · {HR_LEAVE_HALF_DAY_LABELS[request.endHalfDay]}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Type de congé</dt>
              <dd className="mt-1 text-[11px]">
                {request.leaveTypeName}
                <span className="ml-1 font-mono text-[10px] text-muted">
                  {request.leaveTypeCode}
                </span>
                <span className="ml-1 text-muted">
                  {request.leaveTypePaid ? "· payé" : "· non payé"}
                </span>
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Salaire sur la période</dt>
              <dd className="mt-1 text-[11px]">
                {request.leaveTypePaid
                  ? "Le salaire reste dû, la déduction porte sur le travail attendu."
                  : "Congé non payé : le salaire suit la retenue de paie."}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Retrait du travail attendu</dt>
              <dd className="mt-1 text-[11px] tabular-nums">
                {totals.halfDays > 0 ? (
                  <>
                    {formatHalfDays(totals.halfDays)} demi-journée
                    {totals.halfDays > 1 ? "s" : ""} · {formatHours(totals.hours)} h sur{" "}
                    {totals.days} jour{totals.days > 1 ? "s" : ""}
                  </>
                ) : (
                  "Aucun jour ouvré sur la période : rien n'est retiré."
                )}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Motif</dt>
              <dd className="mt-1 text-[11px] break-words">
                {request.reason ?? <span className="text-muted">Non renseigné</span>}
              </dd>
            </div>
          </dl>

          {request.decidedAt ? (
            <div className="border-t border-line px-4 py-3">
              <p className={LABEL}>Décision</p>
              <p className="mt-1 text-[11px]">
                Statut «{" "}
                {request.status === "validated"
                  ? "validé"
                  : request.status === "refused"
                    ? "refusé"
                    : "annulé"}{" "}
                », décision prise le{" "}
                {new Intl.DateTimeFormat("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "Africa/Abidjan",
                }).format(request.decidedAt)}
                {request.decisionNote ? ` : ${request.decisionNote}` : ""}
              </p>
            </div>
          ) : null}
        </section>

        {draft && canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-sm font-semibold">Décision</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Valider une demande la fait compter dans le calendrier du salarié et dans son solde.
              Un refus porte son motif. Une annulation retire la demande sans l&apos;effacer, tandis
              qu&apos;une suppression efface le brouillon.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ValidateLeaveRequestButton requestId={request.id} label={reference} />
              <CancelLeaveRequestButton requestId={request.id} label={reference} />
              <DeleteLeaveRequestButton requestId={request.id} label={reference} />
              <RefuseLeaveRequestForm requestId={request.id} label={reference} />
            </div>
          </section>
        ) : null}

        {request.status === "validated" && canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-sm font-semibold">Annulation</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Une demande validée se retire du calendrier en l&apos;annulant : le travail attendu et
              le solde reviennent à leur état antérieur.
            </p>
            <div className="mt-3">
              <CancelLeaveRequestButton requestId={request.id} label={reference} />
            </div>
          </section>
        ) : null}

        {draft && canWrite && employees && types ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Corriger le brouillon</h2>
            <div className="mt-4">
              <LeaveRequestForm
                mode="edit"
                requestId={request.id}
                request={{
                  employeeId: request.employeeId,
                  leaveTypeId: request.leaveTypeId,
                  startDate: request.startDate,
                  endDate: request.endDate,
                  startHalfDay: request.startHalfDay,
                  endHalfDay: request.endHalfDay,
                  reason: request.reason ?? "",
                }}
                employees={employees
                  .filter((employee) => employee.status !== "left")
                  .map((employee) => ({
                    id: employee.id,
                    code: employee.code,
                    fullName: employee.fullName,
                  }))}
                leaveTypes={types.map((type) => ({
                  id: type.id,
                  code: type.code,
                  name: type.name,
                }))}
                today={request.startDate}
              />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
