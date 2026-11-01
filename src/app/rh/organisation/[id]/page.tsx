import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Network, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DepartmentActiveButton, DepartmentForm } from "@/components/hr-forms";
import { EmployeeStatusBadge } from "@/components/hr-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import {
  getDepartmentTree,
  listDepartments,
  listEmployees,
  type DepartmentNode,
} from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Service",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function findNode(nodes: readonly DepartmentNode[], id: string): DepartmentNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findNode(node.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

export default function DepartmentPage(props: PageProps<"/rh/organisation/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du service…" />}>
      <DepartmentContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function DepartmentContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/organisation/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }

  const db = getDb();
  const [tree, departments, staff, employees, memberships, query, canWrite] = await Promise.all([
    getDepartmentTree(db, { tenantId: session.tenantId }),
    listDepartments(db, { tenantId: session.tenantId, activeOnly: true }),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listEmployees(db, { tenantId: session.tenantId, departmentId: id, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
    searchParams,
    canAccessModule(session, "hr", "write"),
  ]);
  const department = findNode(tree, id);
  if (!department) {
    notFound();
  }

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const employeeOptions = staff.map((employee) => ({
    id: employee.id,
    code: employee.code,
    fullName: employee.fullName,
  }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/organisation"
            aria-label="Revenir à l'organisation"
            title="Revenir à l'organisation"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Organisation
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {department.name}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">{department.code}</p>
          </div>
          {canWrite ? (
            <DepartmentActiveButton
              departmentId={department.id}
              code={department.code}
              active={department.active}
              onDetail
            />
          ) : null}
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Service créé." : "Service mis à jour."}
          </p>
        ) : null}

        {!department.active ? (
          <p className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper">
            Service désactivé : il n&apos;est plus proposé à la saisie, mais les fiches rattachées
            conservent la référence.
          </p>
        ) : null}

        <dl className="mt-4 grid gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Effectif rattaché</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{department.headcount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Effectif cumulé</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{department.totalHeadcount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Services enfants</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{department.children.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Statut</dt>
            <dd className="mt-1 text-sm font-medium">{department.active ? "Actif" : "Inactif"}</dd>
          </div>
        </dl>

        <section className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
          <h2 className="text-[11px] font-semibold">Rattachements</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] text-muted">Service parent</dt>
              <dd className="mt-1 text-[12px]">
                {department.parentId ? (
                  <Link
                    href={`/rh/organisation/${department.parentId}`}
                    className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
                  >
                    {department.parentName ?? department.parentId}
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </Link>
                ) : (
                  "Aucun — service racine"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-muted">Responsable</dt>
              <dd className="mt-1 text-[12px]">
                {department.responsibleEmployeeId ? (
                  <Link
                    href={`/rh/personnel/${department.responsibleEmployeeId}`}
                    className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
                  >
                    {department.responsibleName ?? "Fiche salarié"}
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </Link>
                ) : (
                  "Aucun responsable désigné"
                )}
              </dd>
            </div>
          </dl>
          {department.children.length > 0 ? (
            <p className="mt-3 text-[10px] leading-4 text-muted">
              Enfants :{" "}
              {department.children.map((child) => `${child.code} · ${child.name}`).join(", ")}
            </p>
          ) : null}
        </section>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Users className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Salariés rattachés</h2>
          </div>
          {employees.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucun salarié actif ou suspendu dans ce service.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Salariés rattachés au service</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Matricule
                    </th>
                    <th scope="col" className={TH}>
                      Salarié
                    </th>
                    <th scope="col" className={TH}>
                      Poste
                    </th>
                    <th scope="col" className={TH}>
                      Entrée
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
                      <td className="px-4 py-2.5 font-medium">{employee.fullName}</td>
                      <td className="px-4 py-2.5 text-[10px] text-muted">
                        {employee.position ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(employee.hireDate)}
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

        {canWrite ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold">Modifier le service</summary>
            <div className="mt-4">
              <DepartmentForm
                mode="edit"
                departmentId={department.id}
                departments={departments.map((item) => ({
                  id: item.id,
                  code: item.code,
                  name: item.name,
                }))}
                employees={employeeOptions}
                department={{
                  code: department.code,
                  name: department.name,
                  parentId: department.parentId,
                  responsibleEmployeeId: department.responsibleEmployeeId,
                  active: department.active,
                }}
              />
            </div>
          </details>
        ) : null}

        {!canWrite ? (
          <p className="mt-4 flex items-center gap-2 text-[10px] text-muted">
            <Network className="size-3.5" aria-hidden="true" />
            Lecture seule : le niveau écriture sur le module RH est requis pour modifier un service.
          </p>
        ) : null}
      </main>
    </div>
  );
}
