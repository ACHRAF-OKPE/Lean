import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  Fingerprint,
  Network,
  UserCog,
  Users,
} from "lucide-react";
import { ContractStatusBadge, EmployeeStatusBadge } from "@/components/hr-badges";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getHrOverview, listContracts, listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Ressources humaines",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const SECTIONS = [
  { href: "/rh/organisation", label: "Organisation", icon: Network },
  { href: "/rh/personnel", label: "Personnel", icon: Users },
  { href: "/rh/contrats", label: "Contrats de travail", icon: Briefcase },
  { href: "/rh/temps", label: "Temps de travail", icon: CalendarDays },
  { href: "/rh/pointages", label: "Pointages", icon: Fingerprint },
] as const;

export default function HrPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des ressources humaines…" />}>
      <HrContent />
    </Suspense>
  );
}

async function HrContent() {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const [overview, employees, contracts, memberships, canWrite] = await Promise.all([
    getHrOverview(db, { tenantId: session.tenantId }),
    listEmployees(db, { tenantId: session.tenantId, limit: 6 }),
    // HR-005 — le hub est une lecture : aucun salaire, même pour un membre en écriture.
    listContracts(db, { tenantId: session.tenantId, showSalary: false, limit: 6 }),
    listMembershipsForUser(db, session.userId),
    canAccessModule(session, "hr", "write"),
  ]);

  const counters = [
    { label: "Services", value: overview.departments },
    { label: "Effectif actif", value: overview.activeEmployees },
    { label: "Suspendus", value: overview.suspendedEmployees },
    { label: "Sortis", value: overview.leftEmployees },
    { label: "Contrats en cours", value: overview.runningContracts },
    { label: "Périodes d'essai", value: overview.trialContracts },
    { label: "Arrivées du mois", value: overview.hiresThisMonth },
    { label: "Sorties du mois", value: overview.departuresThisMonth },
  ];

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ressources humaines
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Personnel de l&apos;espace</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Organisation en services, fiches salarié et contrats de travail. Les compteurs sont
              recalculés à la lecture, à l&apos;heure d&apos;Abidjan ; rien ne se lit ni ne se
              modifie hors de son espace. Le salaire brut reste sur le contrat, à partir du niveau
              écriture.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-label={section.label}
                  title={section.label}
                  className={ACTION_LINK}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </Link>
              );
            })}
            {canWrite ? <CatalogActions kind="hr_employees" /> : null}
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {counters.map((counter) => (
            <div key={counter.label} className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">{counter.label}</dt>
              <dd className="mt-1 font-mono text-2xl tabular-nums">{counter.value}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UserCog className="size-4 text-brand" aria-hidden="true" />
              Fiches du personnel
            </h2>
            <Link
              href="/rh/personnel"
              aria-label="Ouvrir le personnel"
              title="Tout le personnel"
              className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {employees.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune fiche salarié. Saisissez-la dans Personnel ou importez le personnel depuis le
              modèle XLSX.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Six premières fiches salarié de l&apos;espace</caption>
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
                          {employee.position ?? "Poste non renseigné"} · embauché(e) le{" "}
                          {isoDateLabel(employee.hireDate)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px]">
                        {employee.departmentCode ?? "—"}
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

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Briefcase className="size-4 text-brand" aria-hidden="true" />
              Contrats récents
            </h2>
            <Link
              href="/rh/contrats"
              aria-label="Ouvrir les contrats"
              title="Tous les contrats"
              className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {contracts.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun contrat. Un contrat naît en brouillon, puis sort du brouillon en gestion.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Six contrats de travail les plus récents</caption>
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
                      Statut
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract) => (
                    <tr key={contract.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{contract.employeeName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {contract.employeeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px]">{contract.kindLabel}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(contract.startDate)} —{" "}
                        {contract.endDate ? isoDateLabel(contract.endDate) : "sans fin"}
                      </td>
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
      </main>
    </div>
  );
}
