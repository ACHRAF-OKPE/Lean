import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Network } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DepartmentForm } from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { listDepartments, listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Nouveau service",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewDepartmentPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la saisie du service…" />}>
      <NewDepartmentContent />
    </Suspense>
  );
}

async function NewDepartmentContent() {
  await connection();
  const session = await requireModule("hr", "write");
  const db = getDb();
  const [departments, employees, memberships] = await Promise.all([
    listDepartments(db, { tenantId: session.tenantId, activeOnly: true }),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/rh/organisation"
            aria-label="Revenir à l'organisation"
            title="Revenir à l'organisation"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Organisation
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouveau service</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Code et nom sont uniques dans l&apos;espace. Le service parent se choisit parmi les
          services actifs, l&apos;arbre est vérifié avant écriture : un service ne peut pas
          descendre de lui-même ni de l&apos;un de ses descendants.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Caractéristiques du service</h2>
          </div>
          <div className="mt-4">
            <DepartmentForm
              mode="create"
              departments={departments.map((department) => ({
                id: department.id,
                code: department.code,
                name: department.name,
              }))}
              employees={employees.map((employee) => ({
                id: employee.id,
                code: employee.code,
                fullName: employee.fullName,
              }))}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
