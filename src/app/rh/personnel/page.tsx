import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Filter, Users, X } from "lucide-react";
import type { HrEmployeeStatus } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { EmployeeStatusBadge } from "@/components/hr-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_EMPLOYEE_STATUSES,
  HR_EMPLOYEE_STATUS_LABELS,
  HR_LIST_LIMIT,
  isHrEmployeeStatus,
} from "@/modules/hr/constants";
import {
  countEmployees,
  getHrOverview,
  listDepartments,
  listEmployees,
  type EmployeeFilters,
} from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Personnel",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** HR-007 — service, statut et recherche se combinent ; rien ne sort de l'espace. */
function parseFilters(
  query: SearchParams,
  departmentIds: Set<string>,
): Omit<EmployeeFilters, "tenantId"> {
  const service = first(query.service);
  const statut = first(query.statut);
  return {
    departmentId: departmentIds.has(service) ? service : undefined,
    status: isHrEmployeeStatus(statut) ? (statut as HrEmployeeStatus) : undefined,
    search: first(query.q).trim() || undefined,
  };
}

export default function PersonnelPage(props: PageProps<"/rh/personnel">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du personnel…" />}>
      <PersonnelContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PersonnelContent({
  searchParams,
}: Pick<PageProps<"/rh/personnel">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const [query, memberships, departments, overview, canWrite] = await Promise.all([
    searchParams,
    listMembershipsForUser(db, session.userId),
    listDepartments(db, { tenantId: session.tenantId }),
    getHrOverview(db, { tenantId: session.tenantId }),
    canAccessModule(session, "hr", "write"),
  ]);

  const filters = parseFilters(query, new Set(departments.map((item) => item.id)));
  const [employees, total] = await Promise.all([
    listEmployees(db, { tenantId: session.tenantId, ...filters, limit: HR_LIST_LIMIT }),
    countEmployees(db, { tenantId: session.tenantId, ...filters }),
  ]);
  const filtered =
    Boolean(filters.departmentId) || Boolean(filters.status) || Boolean(filters.search);
  const removed = typeof query.supprime === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ressources humaines
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Personnel</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Fiches salarié de l&apos;espace : matricule, identité, service, manager, statut. La
              liste n&apos;affiche aucun salaire — le montant brut reste sur le contrat, à partir du
              niveau écriture.
            </p>
          </div>
          {canWrite ? <CatalogActions kind="hr_employees" canDraft={canWrite} /> : null}
        </div>

        {removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Fiche supprimée.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Actifs</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.activeEmployees}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Suspendus</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.suspendedEmployees}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Sortis</dt>
            <dd className="mt-1 font-mono text-2xl text-muted tabular-nums">
              {overview.leftEmployees}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Contrats en cours</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.runningContracts}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Périodes d&apos;essai</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.trialContracts}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Arrivées du mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.hiresThisMonth}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Sorties du mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.departuresThisMonth}</dd>
          </div>
        </dl>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <Filter className="size-3.5 self-center text-muted" aria-hidden="true" />
          <label className="text-[10px] text-muted">
            Service
            <select name="service" defaultValue={filters.departmentId ?? ""} className={CONTROL}>
              <option value="">Tous</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} · {department.name}
                  {department.active ? "" : " (inactif)"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Statut
            <select name="statut" defaultValue={filters.status ?? ""} className={CONTROL}>
              <option value="">Tous</option>
              {HR_EMPLOYEE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HR_EMPLOYEE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Recherche
            <input
              name="q"
              defaultValue={filters.search ?? ""}
              placeholder="Matricule, nom ou prénom"
              className={`${CONTROL} w-56`}
            />
          </label>
          <button
            type="submit"
            aria-label="Filtrer le personnel"
            title="Filtrer le personnel"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {filtered ? (
            <Link
              href="/rh/personnel"
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
              <Users className="size-4 text-brand" aria-hidden="true" />
              Fiches salarié
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {total} fiche{total > 1 ? "s" : ""}
              {filtered ? " correspondant aux filtres" : " dans l'espace"}
            </p>
          </div>
          {employees.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Users className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                {filtered
                  ? "Aucune fiche ne correspond à ces filtres."
                  : "Aucune fiche salarié. Saisissez-la ou importez le personnel depuis le modèle XLSX."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Personnel de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Matricule
                    </th>
                    <th scope="col" className={TH}>
                      Salarié
                    </th>
                    <th scope="col" className={TH}>
                      Service
                    </th>
                    <th scope="col" className={TH}>
                      Manager
                    </th>
                    <th scope="col" className={TH}>
                      Embauche
                    </th>
                    <th scope="col" className={TH}>
                      Sortie
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
                  {employees.map((employee) => (
                    <tr key={employee.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {employee.code}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{employee.fullName}</span>
                        <span className="block text-[10px] text-muted">
                          {employee.position ?? "Poste non renseigné"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px]">
                        {employee.departmentCode ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[10px]">{employee.managerName ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(employee.hireDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {employee.departureDate ? isoDateLabel(employee.departureDate) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <EmployeeStatusBadge status={employee.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/personnel/${employee.id}`}
                          aria-label={`Ouvrir la fiche ${employee.code}`}
                          title="Ouvrir la fiche"
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

        {employees.length === HR_LIST_LIMIT ? (
          <p className="mt-3 text-[10px] leading-4 text-muted">
            Affichage des {HR_LIST_LIMIT} premières fiches par matricule. Affinez la recherche ou
            l&apos;import pour retrouver une fiche.
          </p>
        ) : null}
      </main>
    </div>
  );
}
