import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LeaveRequestForm } from "@/components/hr-leave-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { listLeaveTypes } from "@/modules/hr/leave-queries";
import { listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Nouvelle demande de congé",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewLeaveRequestPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la demande de congé…" />}>
      <NewLeaveRequestContent />
    </Suspense>
  );
}

async function NewLeaveRequestContent() {
  await connection();
  const session = await requireModule("hr", "write");
  const db = getDb();
  const today = todayIsoDate();

  const [employees, types, memberships] = await Promise.all([
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listLeaveTypes(db, session.tenantId, { activeOnly: true }),
    listMembershipsForUser(db, session.userId),
  ]);

  const selectable = employees
    .filter((employee) => employee.status !== "left")
    .map((employee) => ({
      id: employee.id,
      code: employee.code,
      fullName: employee.fullName,
    }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/rh/conges"
            aria-label="Revenir aux congés"
            title="Revenir aux congés"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Congés</p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle demande</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Choisissez le salarié et le type de congé actif, puis la période en demi-journées. La
          demande naît en brouillon : la validation ou le refus relèvent de la gestion. Une demande
          qui recouvre une autre demande active du même salarié est refusée à l&apos;enregistrement.
        </p>

        {selectable.length === 0 || types.length === 0 ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            {selectable.length === 0
              ? "Aucun salarié actif dans l'espace : créez d'abord une fiche dans Personnel."
              : "Aucun type de congé actif : ouvrez Types de congé pour en inscrire un."}
          </p>
        ) : null}

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Demande de congé</h2>
          </div>
          <div className="mt-4">
            <LeaveRequestForm
              mode="create"
              today={today}
              employees={selectable}
              leaveTypes={types.map((type) => ({
                id: type.id,
                code: type.code,
                name: type.name,
              }))}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
