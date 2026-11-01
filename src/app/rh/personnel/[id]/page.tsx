import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Briefcase, Fingerprint, Lock, Plus, UserCog } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  ContractStatusBadge,
  EmployeeStatusBadge,
  TimeEntryStatusBadge,
} from "@/components/hr-badges";
import {
  DeleteEmployeeButton,
  EmployeeForm,
  LinkAccountForm,
  UnlinkAccountButton,
} from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import type { HrTimeEntryKind, HrTimeEntryPeriod } from "@/db/schema";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listTeam } from "@/modules/identity/team";
import {
  HR_LIST_LIMIT,
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
} from "@/modules/hr/constants";
import { getEmployee, listDepartments, listEmployees } from "@/modules/hr/queries";
import { formatHours } from "@/modules/hr/time";
import { listTimeEntries, listWorkCalendars } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Fiche salarié",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EmployeePage(props: PageProps<"/rh/personnel/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la fiche salarié…" />}>
      <EmployeeContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function EmployeeContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/personnel/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const canWrite = await canAccessModule(session, "hr", "write");
  const canManage = await canAccessModule(session, "hr", "manage");
  const [employee, departments, staff, calendars, team, memberships, entries, query] =
    await Promise.all([
      // HR-005 — le salaire des contrats de la fiche ne se lit qu'à partir du niveau écriture.
      getEmployee(db, { tenantId: session.tenantId, employeeId: id, showSalary: canWrite }),
      listDepartments(db, { tenantId: session.tenantId, activeOnly: true }),
      listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
      // HR-009 — la fiche rattache un calendrier de travail, sinon elle suit celui de l'espace.
      listWorkCalendars(db, session.tenantId),
      listTeam(db, session.tenantId),
      listMembershipsForUser(db, session.userId),
      // HR-011 — les six dernières ligues de la fiche, sans salaire.
      listTimeEntries(db, { tenantId: session.tenantId, employeeId: id, limit: 6 }),
      searchParams,
    ]);
  if (!employee) {
    notFound();
  }

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const managers = staff.filter((item) => item.id !== employee.id && item.status !== "left");
  const appliedCalendar =
    calendars.find((item) => item.id === employee.workCalendarId) ??
    calendars.find((item) => item.isDefault) ??
    null;
  const members = team.members.map((member) => ({
    userId: member.userId,
    label: `${member.name} · ${member.email}`,
  }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/personnel"
            aria-label="Revenir au personnel"
            title="Revenir au personnel"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Personnel
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {employee.fullName}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {employee.code} · {employee.position ?? "Poste non renseigné"}
            </p>
          </div>
          {canWrite && employee.status !== "left" ? (
            <Link
              href={`/rh/pointages/nouveau?salarie=${employee.id}`}
              aria-label="Nouvelle ligue de pointage"
              title="Nouvelle ligue de pointage pour ce salarié"
              className={ACTION_LINK}
            >
              <Fingerprint className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          {canManage ? (
            <DeleteEmployeeButton
              employeeId={employee.id}
              code={employee.code}
              fullName={employee.fullName}
            />
          ) : null}
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Fiche créée." : "Fiche mise à jour."}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <EmployeeStatusBadge status={employee.status} />
          {employee.status === "left" ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <Lock className="size-3" aria-hidden="true" />
              Fiche conservée : la sortie ne supprime jamais l&apos;historique.
            </span>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Service</dt>
            <dd className="mt-1 text-[12px]">
              {employee.departmentId ? (
                <Link
                  href={`/rh/organisation/${employee.departmentId}`}
                  className="font-mono underline decoration-line underline-offset-4 hover:decoration-brand"
                >
                  {employee.departmentCode ?? "Service"}
                </Link>
              ) : (
                "Aucun service"
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Manager</dt>
            <dd className="mt-1 text-[12px]">
              {employee.managerEmployeeId ? (
                <Link
                  href={`/rh/personnel/${employee.managerEmployeeId}`}
                  className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
                >
                  {employee.managerName ?? "Fiche salarié"}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              ) : (
                "Aucun manager"
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Embauche</dt>
            <dd className="mt-1 text-[12px] tabular-nums">{isoDateLabel(employee.hireDate)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Sortie</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {employee.departureDate ? isoDateLabel(employee.departureDate) : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Calendrier</dt>
            <dd className="mt-1 text-[12px]">
              {appliedCalendar ? (
                <Link
                  href={`/rh/temps/calendriers/${appliedCalendar.id}`}
                  className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
                >
                  {appliedCalendar.name}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              ) : (
                "Aucun calendrier"
              )}
            </dd>
          </div>
        </dl>

        <section className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold">
            <UserCog className="size-3.5 text-brand" aria-hidden="true" />
            Compte de connexion
          </h2>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            HR-003 — rattacher un compte relie la fiche à l&apos;espace de travail. Les droits
            restent ceux du compte, réglés dans l&apos;équipe : le rattachement n&apos;en change
            aucun.
          </p>
          <div className="mt-3">
            {employee.userId ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px]">
                  Rattaché à <span className="font-mono">{employee.userEmail ?? "—"}</span>
                </p>
                {canWrite ? (
                  <UnlinkAccountButton employeeId={employee.id} code={employee.code} />
                ) : null}
              </div>
            ) : canWrite ? (
              <LinkAccountForm
                employeeId={employee.id}
                members={members}
                currentUserId={employee.userId}
              />
            ) : (
              <p className="text-[12px] text-muted">Aucun compte rattaché.</p>
            )}
          </div>
        </section>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Briefcase className="size-4 text-brand" aria-hidden="true" />
              Historique des contrats
            </h2>
            {canWrite ? (
              <Link
                href={`/rh/contrats/nouvelle?salarie=${employee.id}`}
                aria-label="Créer un contrat"
                title="Créer un contrat pour ce salarié"
                className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          {employee.contracts.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucun contrat pour cette fiche. Un contrat naît en brouillon, puis sort du brouillon
              en gestion.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Contrats de travail de la fiche, du plus récent au plus ancien
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Période
                    </th>
                    <th scope="col" className={TH}>
                      Essai
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Hebdo
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Salaire brut
                      </th>
                    ) : null}
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employee.contracts.map((contract) => (
                    <tr key={contract.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {contract.kindLabel}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(contract.startDate)} —{" "}
                        {contract.endDate ? isoDateLabel(contract.endDate) : "sans fin"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {contract.trialDeadline
                          ? `jusqu'au ${isoDateLabel(contract.trialDeadline)}`
                          : "aucune"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {contract.weeklyHours} h
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {contract.salaryXof ? formatXof(contract.salaryXof) : "Non renseigné"}
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5">
                        <ContractStatusBadge status={contract.displayStatus} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/contrats/${contract.id}`}
                          aria-label={`Ouvrir le contrat ${contract.kindLabel} de ${contract.employeeCode}`}
                          title="Ouvrir le contrat"
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

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Fingerprint className="size-4 text-brand" aria-hidden="true" />
              Ligues de pointage
            </h2>
            <Link
              href={`/rh/pointages?salarie=${employee.id}`}
              aria-label="Ouvrir les pointages de la fiche"
              title="Tous les pointages de la fiche"
              className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {entries.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucune ligue de pointage. Ajoutez-en une, en brouillon : seule une demi-journée
              attendue par le calendrier applicable du jour peut être pointée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Six dernières ligues de pointage de la fiche, du jour le plus récent au plus
                  ancien
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Nature
                    </th>
                    <th scope="col" className={TH}>
                      Période
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
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(entry.workDate)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {HR_TIME_ENTRY_KIND_LABELS[entry.kind as HrTimeEntryKind]}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {HR_TIME_ENTRY_PERIOD_LABELS[entry.period as HrTimeEntryPeriod]}
                        {entry.hours ? ` · ${formatHours(Number(entry.hours))} h` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        <TimeEntryStatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/pointages/${entry.id}`}
                          aria-label={`Ouvrir la ligue du ${entry.workDate}`}
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

        {canWrite ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold">Modifier la fiche</summary>
            <div className="mt-4">
              <EmployeeForm
                mode="edit"
                employeeId={employee.id}
                departments={departments.map((department) => ({
                  id: department.id,
                  code: department.code,
                  name: department.name,
                }))}
                managers={managers.map((item) => ({
                  id: item.id,
                  code: item.code,
                  fullName: item.fullName,
                }))}
                calendars={calendars.map((calendar) => ({
                  id: calendar.id,
                  name: calendar.name,
                  isDefault: calendar.isDefault,
                }))}
                employee={{
                  code: employee.code,
                  lastName: employee.lastName,
                  firstName: employee.firstName,
                  position: employee.position,
                  hireDate: employee.hireDate,
                  status: employee.status,
                  departureDate: employee.departureDate,
                  departmentId: employee.departmentId,
                  managerEmployeeId: employee.managerEmployeeId,
                  workCalendarId: employee.workCalendarId,
                }}
              />
            </div>
          </details>
        ) : (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Lecture seule : le niveau écriture sur le module RH est requis pour modifier une fiche,
            rattacher un compte ou lire un salaire. Supprimer une fiche relève de la gestion.
          </p>
        )}
      </main>
    </div>
  );
}
