import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DeleteLeaveTypeButton, LeaveTypeForm } from "@/components/hr-leave-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getLeaveType } from "@/modules/hr/leave-queries";

export const metadata: Metadata = {
  title: "Type de congé",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function LeaveTypePage(props: PageProps<"/rh/conges/types/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du type de congé…" />}>
      <LeaveTypeContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeaveTypeContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/conges/types/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [leaveType, canManage, memberships] = await Promise.all([
    getLeaveType(db, session.tenantId, id),
    canAccessModule(session, "hr", "manage"),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!leaveType) {
    notFound();
  }

  const query = await searchParams;
  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/conges/types"
            aria-label="Revenir aux types de congé"
            title="Revenir aux types de congé"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Type de congé
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {leaveType.name}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {leaveType.code} · droit annuel {leaveType.annualAllowanceDays.replace(".", ",")} j ·{" "}
              {leaveType.active ? "actif" : "désactivé"}
            </p>
          </div>
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Type de congé inscrit." : "Type de congé mis à jour."}
          </p>
        ) : null}

        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-muted">
          Le droit annuel sert de base au solde du salarié : les jours validés et les jours en
          brouillon s&apos;en déduisent. Désactiver un type empêche de nouvelles demandes, sans
          toucher à celles déjà posées.
        </p>

        {canManage ? (
          <>
            <section className="mt-5 rounded-xl border border-line bg-panel p-5">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-brand" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Paramètres du type</h2>
              </div>
              <div className="mt-4">
                <LeaveTypeForm
                  mode="edit"
                  leaveTypeId={leaveType.id}
                  leaveType={{
                    id: leaveType.id,
                    code: leaveType.code,
                    name: leaveType.name,
                    paid: leaveType.paid,
                    halfDayAllowed: leaveType.halfDayAllowed,
                    annualAllowanceDays: leaveType.annualAllowanceDays,
                    active: leaveType.active,
                  }}
                />
              </div>
            </section>

            <div className="mt-4 flex justify-end">
              <DeleteLeaveTypeButton leaveTypeId={leaveType.id} label={leaveType.name} />
            </div>
          </>
        ) : (
          <p className="mt-5 rounded-xl border border-line bg-panel px-5 py-4 text-[11px] leading-5 text-muted">
            Le paramétrage du type demande le niveau gestion. Vous le lisez en lecture seule.
          </p>
        )}
      </main>
    </div>
  );
}
