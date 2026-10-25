import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ScrollText } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { ACTION_LABELS } from "@/modules/identity/labels";
import { listAuditEvents } from "@/modules/identity/queries";

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
  const events = await listAuditEvents(getDb(), { tenantId: session.tenantId });

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              aria-label="Retour au poste de pilotage"
              title="Retour au poste de pilotage"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="text-sm font-semibold tracking-tight">Journal d&apos;audit</p>
              <p className="text-[11px] text-muted">{session.tenantName}</p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
            <ScrollText className="size-3" aria-hidden="true" />
            {events.length} évènement{events.length > 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <p className="max-w-2xl text-[11px] leading-5 text-muted">
          Chaque connexion, déconnexion et changement d&apos;espace est enregistré avec son acteur
          et son horodatage. Les lectures sont limitées à l&apos;espace de travail actif.
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
