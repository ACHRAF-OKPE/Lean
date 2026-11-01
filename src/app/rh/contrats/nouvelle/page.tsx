import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Briefcase } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ContractForm } from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Nouveau contrat",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewContractPage(props: PageProps<"/rh/contrats/nouvelle">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la saisie du contrat…" />}>
      <NewContractContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function NewContractContent({
  searchParams,
}: Pick<PageProps<"/rh/contrats/nouvelle">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "write");
  const db = getDb();
  const [employees, memberships, query] = await Promise.all([
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);

  // HR-004 — la fiche salarié qui ouvre l'écran porte déjà son salarié sur le contrat.
  const salarieParam = typeof query.salarie === "string" ? query.salarie : "";
  const presetEmployeeId = employees.some(
    (employee) => employee.id === salarieParam && employee.status !== "left",
  )
    ? salarieParam
    : undefined;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/rh/contrats"
            aria-label="Revenir aux contrats"
            title="Revenir aux contrats"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Contrats de travail
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouveau contrat</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le contrat s&apos;écrit d&apos;abord en brouillon : CDD, intérim et stage exigent une date
          de fin, la période d&apos;essai ne peut dépasser la durée du contrat et un salarié ne
          porte qu&apos;un seul contrat en cours. Le passage en cours se fait sur la fiche du
          contrat, en gestion.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <Briefcase className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Caractéristiques du contrat</h2>
          </div>
          <div className="mt-4">
            <ContractForm
              mode="create"
              presetEmployeeId={presetEmployeeId}
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
