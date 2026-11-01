import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, UserPlus } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { EmployeeForm } from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { listDepartments, listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Nouvelle fiche salarié",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewEmployeePage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la saisie de la fiche…" />}>
      <NewEmployeeContent />
    </Suspense>
  );
}

async function NewEmployeeContent() {
  await connection();
  const session = await requireModule("hr", "write");
  const db = getDb();
  const [departments, staff, memberships] = await Promise.all([
    listDepartments(db, { tenantId: session.tenantId, activeOnly: true }),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
  ]);
  const managers = staff.filter((employee) => employee.status !== "left");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/rh/personnel"
            aria-label="Revenir au personnel"
            title="Revenir au personnel"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Personnel
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle fiche salarié</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le matricule est unique dans l&apos;espace. Le service et le manager se choisissent parmi
          les données déjà saisies ; le compte de connexion se rattache depuis la fiche, et ce
          rattachement ne change aucun droit. La fiche ne porte jamais de salaire : le montant brut
          appartient au contrat.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Identité et rattachements</h2>
          </div>
          <div className="mt-4">
            <EmployeeForm
              mode="create"
              departments={departments.map((department) => ({
                id: department.id,
                code: department.code,
                name: department.name,
              }))}
              managers={managers.map((employee) => ({
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
