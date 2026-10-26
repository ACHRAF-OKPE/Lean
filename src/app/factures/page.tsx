import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CircleAlert, ReceiptText } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { InvoiceStatusBadge } from "@/components/sales-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getReceivablesStats, listInvoices } from "@/modules/sales/queries";

export const metadata: Metadata = {
  title: "Factures",
};

const TH = "px-4 py-2.5 font-normal";

export default function InvoicesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des factures…" />}>
      <InvoicesContent />
    </Suspense>
  );
}

async function InvoicesContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [invoices, stats, memberships] = await Promise.all([
    listInvoices(db, session.tenantId),
    getReceivablesStats(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="invoices" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Facturation
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Factures client</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Seules les factures validées portent un numéro et créent une créance. Les règlements
              sont ajoutés au fil de l&apos;eau et réduisent le solde.
            </p>
          </div>
          <Link
            href="/ventes"
            aria-label="Ouvrir les commandes client"
            title="Commandes client"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ReceiptText className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Encours client</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {formatXof(stats.outstandingXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Dont échu</dt>
            <dd
              className={`mt-1 font-mono text-2xl tabular-nums ${
                stats.overdueXof > 0 ? "text-copper" : ""
              }`}
            >
              {formatXof(stats.overdueXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Factures validées</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{stats.validatedCount}</dd>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3">
            <CircleAlert
              className={`size-4 shrink-0 ${stats.draftCount > 0 ? "text-copper" : "text-brand"}`}
              aria-hidden="true"
            />
            <p className="text-[10px] leading-4 text-muted">
              {stats.draftCount} brouillon{stats.draftCount > 1 ? "s" : ""} à valider. Un brouillon
              ne crée aucune créance.
            </p>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {invoices.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune facture. Préparez une facture depuis une commande client confirmée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Factures client de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Facture
                    </th>
                    <th scope="col" className={TH}>
                      Client
                    </th>
                    <th scope="col" className={TH}>
                      Commande
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Échéance
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Total HT
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Réglé
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Solde
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
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {invoice.number ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{invoice.customerName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {invoice.customerCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                        {invoice.orderNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(invoice.invoiceDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(invoice.dueDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(invoice.exTaxTotal)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(invoice.paidXof)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(invoice.balanceXof)}
                      </td>
                      <td className="px-4 py-2.5">
                        <InvoiceStatusBadge status={invoice.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/factures/${invoice.id}`}
                          aria-label={`Ouvrir la facture ${invoice.number ?? "brouillon"}`}
                          title="Ouvrir la facture"
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

        {invoices.length === 200 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 200 factures les plus récentes.
          </p>
        ) : null}
      </main>
    </div>
  );
}
