import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ScrollText } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { ACTION_LABELS } from "@/modules/identity/labels";
import { listAuditEvents, listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Journal d'audit",
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

function auditDetails(details: Record<string, unknown>): string {
  return Object.keys(details).length > 0 ? JSON.stringify(details) : "—";
}

export default function AuditPage() {
  return (
    <Suspense fallback={<AuditFallback />}>
      <AuditContent />
    </Suspense>
  );
}

function AuditFallback() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
      <div className="h-6 w-48 animate-pulse rounded bg-line" />
      <div className="mt-6 h-64 animate-pulse rounded-xl border border-line bg-panel" />
    </main>
  );
}

async function AuditContent() {
  await connection();
  const session = await requirePermission("audit.read");
  const db = getDb();
  const [events, memberships] = await Promise.all([
    listAuditEvents(db, { tenantId: session.tenantId }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="audit" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Traçabilité
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">Journal d&apos;audit</h1>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
            <ScrollText className="size-3" aria-hidden="true" />
            {events.length} évènement{events.length > 1 ? "s" : ""}
          </span>
        </div>

        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque connexion, déconnexion, changement d&apos;espace, création de référentiel et import
          appliqué est enregistré avec son acteur et son horodatage. Les lectures sont limitées à
          l&apos;espace de travail actif.
        </p>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {events.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] text-muted">
              Aucun évènement pour cet espace de travail.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Évènements d&apos;audit de l&apos;espace actif
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Acteur
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Entité
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Détails
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        <time dateTime={event.createdAt.toISOString()}>
                          {dateFormatter.format(event.createdAt)}
                        </time>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {event.actorName ?? "Système"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px]">
                          {ACTION_LABELS[event.action] ?? event.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                        {event.entityType}
                        {event.entityId ? ` · ${event.entityId.slice(0, 8)}` : ""}
                      </td>
                      <td className="max-w-72 truncate px-4 py-2.5 font-mono text-[10px] text-muted">
                        {auditDetails(event.details)}
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
