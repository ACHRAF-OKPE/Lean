import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { MailOpen, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ExchangeStatusBadge, ExchangeTypeBadge } from "@/components/exchange-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listExchangeMessages } from "@/modules/exchange/queries";

export const metadata: Metadata = {
  title: "Échanges",
};

const TH = "px-4 py-2.5 font-normal";
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function ExchangeJournalPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du journal…" />}>
      <ExchangeJournalContent />
    </Suspense>
  );
}

async function ExchangeJournalContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [messages, memberships] = await Promise.all([
    listExchangeMessages(db, { tenantId: session.tenantId, limit: 100 }),
    listMembershipsForUser(db, session.userId),
  ]);
  const sent = messages.filter((message) => message.status === "sent").length;
  const failed = messages.length - sent;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="exchanges" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Flux · fournisseurs
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Échanges</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Journal append-only des demandes et confirmations envoyées aux fournisseurs. Chaque
              ligne conserve le sujet, le corps rendu, la pièce jointe, l&apos;acteur et
              l&apos;horodatage ; un renvoi crée une nouvelle tentative reliée.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
              {sent} envoyé{sent > 1 ? "s" : ""}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] ${
                failed > 0
                  ? "border-copper/20 bg-copper-soft text-copper"
                  : "border-line bg-panel text-muted"
              }`}
            >
              {failed} échec{failed > 1 ? "s" : ""}
            </span>
            {can(session.role, "settings.manage") ? (
              <Link
                href="/parametres/echanges"
                aria-label="Configurer les échanges"
                title="Configurer les échanges"
                className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <MailOpen className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Messages</h2>
            <span className="ml-auto font-mono text-[10px] text-muted">{messages.length}</span>
          </div>

          {messages.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[11px] text-muted">
                Aucun message. Ouvrez une commande demandée ou confirmée pour envoyer un document au
                fournisseur.
              </p>
              <Link
                href="/achats"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline"
              >
                Ouvrir les achats
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Journal des échanges fournisseurs</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Commande
                    </th>
                    <th scope="col" className={TH}>
                      Destinataire
                    </th>
                    <th scope="col" className={TH}>
                      Sujet
                    </th>
                    <th scope="col" className={TH}>
                      Modèle
                    </th>
                    <th scope="col" className={TH}>
                      Acteur
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {DATE_FORMAT.format(message.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <ExchangeTypeBadge type={message.type} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ExchangeStatusBadge status={message.status} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        <Link href={`/achats/${message.orderId}`} className="hover:underline">
                          {message.orderNumber ?? "Brouillon"}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block max-w-48 truncate">
                          {message.recipientName ?? message.supplierName}
                        </span>
                        <span className="block max-w-48 truncate font-mono text-[10px] text-muted">
                          {message.recipient}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/echanges/${message.id}`}
                          className="block max-w-72 truncate font-medium hover:text-brand hover:underline"
                        >
                          {message.subject}
                        </Link>
                        {message.status === "failed" && message.errorMessage ? (
                          <span className="block max-w-72 truncate text-[10px] text-copper">
                            {message.errorMessage}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-40 truncate px-4 py-2.5 text-muted">
                        {message.templateName}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {message.actorName ?? "—"}
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
