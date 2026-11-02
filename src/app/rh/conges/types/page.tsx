import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Plus, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DeleteLeaveTypeButton, LeaveTypeForm } from "@/components/hr-leave-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listLeaveTypes } from "@/modules/hr/leave-queries";

export const metadata: Metadata = {
  title: "Types de congé",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function LeaveTypesPage(props: PageProps<"/rh/conges/types">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des types de congé…" />}>
      <LeaveTypesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LeaveTypesContent({
  searchParams,
}: Pick<PageProps<"/rh/conges/types">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const [types, memberships, canManage] = await Promise.all([
    listLeaveTypes(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    canAccessModule(session, "hr", "manage"),
  ]);

  const query = await searchParams;
  const removed = typeof query.supprime === "string";
  const activeCount = types.filter((type) => type.active).length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-start gap-3">
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
            <h1 className="text-2xl font-medium tracking-tight">Types de congé</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Le type porte le droit annuel, en jours, sur lequel se calcule le solde, et deux
              réglages : congé payé (le salaire reste dû sur la période) et demi-journée autorisée.
              Un type qui porte déjà des demandes se désactive, il ne se supprime pas.
            </p>
          </div>
        </div>

        {removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Type de congé supprimé.
          </p>
        ) : null}

        {canManage ? (
          <details className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-brand" aria-hidden="true" />
              Inscrire un type de congé
            </summary>
            <div className="mt-4">
              <LeaveTypeForm mode="create" />
            </div>
          </details>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              Catalogue
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {types.length} type{types.length > 1 ? "s" : ""} · {activeCount} actif
              {activeCount > 1 ? "s" : ""}
            </p>
          </div>
          {types.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Settings2 className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun type de congé. Inscrivez-en un pour ouvrir les demandes : sans type actif,
                aucune demande ne peut être posée.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Types de congé de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Nom
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Droit annuel
                    </th>
                    <th scope="col" className={TH}>
                      Payé
                    </th>
                    <th scope="col" className={TH}>
                      Demi-journée
                    </th>
                    <th scope="col" className={TH}>
                      Actif
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                    {canManage ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Supprimer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <tr key={type.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {type.code}
                      </td>
                      <td className="px-4 py-2.5 break-words">{type.name}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {type.annualAllowanceDays.replace(".", ",")} j
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{type.paid ? "Oui" : "Non"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {type.halfDayAllowed ? "Autorisée" : "Journée"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {type.active ? "Oui" : "Non"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/conges/types/${type.id}`}
                          aria-label={`Ouvrir le type ${type.name}`}
                          title="Ouvrir le type"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                      {canManage ? (
                        <td className="px-4 py-2.5 text-right">
                          <DeleteLeaveTypeButton leaveTypeId={type.id} label={type.name} />
                        </td>
                      ) : null}
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
