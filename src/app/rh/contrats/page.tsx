import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Briefcase, Filter, Plus, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ContractStatusBadge } from "@/components/hr-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_CONTRACT_DISPLAY_LABELS,
  HR_LIST_LIMIT,
  type HrContractDisplayStatus,
} from "@/modules/hr/constants";
import { listContracts, listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Contrats de travail",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const DISPLAY_STATUSES: readonly HrContractDisplayStatus[] = [
  "draft",
  "running",
  "expired",
  "terminated",
];

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function isDisplayStatus(value: string): value is HrContractDisplayStatus {
  return (DISPLAY_STATUSES as readonly string[]).includes(value);
}

export default function ContractsPage(props: PageProps<"/rh/contrats">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des contrats…" />}>
      <ContractsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ContractsContent({ searchParams }: Pick<PageProps<"/rh/contrats">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  // HR-005 — le salaire ne quitte la base que pour un membre en écriture ou plus.
  const canWrite = await canAccessModule(session, "hr", "write");
  const [query, memberships, contracts, employees] = await Promise.all([
    searchParams,
    listMembershipsForUser(db, session.userId),
    listContracts(db, { tenantId: session.tenantId, showSalary: canWrite, limit: HR_LIST_LIMIT }),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
  ]);

  const statusFilter = first(query.statut);
  const employeeFilter = first(query.salarie);
  const statut = isDisplayStatus(statusFilter) ? statusFilter : "";
  const salarie = employees.some((employee) => employee.id === employeeFilter)
    ? employeeFilter
    : "";
  const filtered = contracts.filter(
    (contract) =>
      (!statut || contract.displayStatus === statut) &&
      (!salarie || contract.employeeId === salarie),
  );
  const hasFilters = Boolean(statut || salarie);
  const removed = typeof query.supprime === "string";

  const counters = DISPLAY_STATUSES.map((status) => ({
    status,
    label: HR_CONTRACT_DISPLAY_LABELS[status],
    value: contracts.filter((contract) => contract.displayStatus === status).length,
  }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ressources humaines
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Contrats de travail</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Un contrat naît en brouillon sur une fiche salarié. Le passage en cours et la
              résiliation relèvent de la gestion : sortis du brouillon, les dates, le type, la durée
              et le salaire sont figés et une correction passe par un nouveau contrat.
            </p>
          </div>
          {canWrite ? (
            <Link
              href="/rh/contrats/nouvelle"
              aria-label="Créer un contrat"
              title="Créer un contrat"
              className={ACTION_LINK}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Brouillon de contrat supprimé.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {counters.map((counter) => (
            <div key={counter.status} className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">{counter.label}</dt>
              <dd
                className={`mt-1 font-mono text-2xl tabular-nums ${
                  counter.status === "running"
                    ? "text-brand"
                    : counter.status === "expired"
                      ? "text-copper"
                      : ""
                }`}
              >
                {counter.value}
              </dd>
            </div>
          ))}
        </dl>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <Filter className="size-3.5 self-center text-muted" aria-hidden="true" />
          <label className="text-[10px] text-muted">
            Statut
            <select name="statut" defaultValue={statut} className={CONTROL}>
              <option value="">Tous</option>
              {DISPLAY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HR_CONTRACT_DISPLAY_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-muted">
            Salarié
            <select name="salarie" defaultValue={salarie} className={`${CONTROL} w-56`}>
              <option value="">Tous</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.code}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-label="Filtrer les contrats"
            title="Filtrer les contrats"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {hasFilters ? (
            <Link
              href="/rh/contrats"
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
              <Briefcase className="size-4 text-brand" aria-hidden="true" />
              Contrats
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {filtered.length} contrat{filtered.length > 1 ? "s" : ""}
              {hasFilters ? " correspondant aux filtres" : ""}
            </p>
          </div>
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Briefcase className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                {hasFilters
                  ? "Aucun contrat ne correspond à ces filtres."
                  : "Aucun contrat. Un contrat se crée sur une fiche salarié, d'abord en brouillon."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Contrats de travail de l&apos;espace, du plus récent au plus ancien
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
                    <th scope="col" className={TH}>
                      Fin
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
                  {filtered.map((contract) => (
                    <tr key={contract.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{contract.employeeName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {contract.employeeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {contract.kindLabel}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(contract.startDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {contract.endDate ? isoDateLabel(contract.endDate) : "sans fin"}
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
                          aria-label={`Ouvrir le contrat de ${contract.employeeName}`}
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

        {contracts.length === HR_LIST_LIMIT ? (
          <p className="mt-3 text-[10px] leading-4 text-muted">
            Lecture des {HR_LIST_LIMIT} contrats les plus récents : compteurs et filtres portent sur
            cette fenêtre. Affinez par salarié pour un espace plus fourni.
          </p>
        ) : null}
      </main>
    </div>
  );
}
