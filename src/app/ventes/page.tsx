import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import {
  DeliveryStateBadge,
  InvoicingStateBadge,
  SalesStatusBadge,
} from "@/components/sales-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { salesStatusLabel } from "@/modules/sales/lifecycle";
import { getSalesOrderStats, listSalesOrders } from "@/modules/sales/queries";

export const metadata: Metadata = {
  title: "Ventes",
};

const TH = "px-4 py-2.5 font-normal";

export default function SalesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des ventes…" />}>
      <SalesContent />
    </Suspense>
  );
}

async function SalesContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [orders, stats, memberships] = await Promise.all([
    listSalesOrders(db, session.tenantId),
    getSalesOrderStats(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="sales" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Ventes</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Commandes client</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Du brouillon à la facture. Une livraison sort le stock, une facture validée crée la
              créance client.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {orders.length} commande{orders.length > 1 ? "s" : ""}
            </span>
            <CatalogActions kind="sales_lines" />
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Commandes ouvertes</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{stats.open}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">En attente de livraison</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">
              {stats.awaitingDelivery}
            </dd>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <ShoppingBag className="size-4 text-brand" aria-hidden="true" />
            <p className="text-[10px] leading-4 text-muted">
              {stats.toInvoice} commande{stats.toInvoice > 1 ? "s" : ""} confirmée
              {stats.toInvoice > 1 ? "s" : ""} restent à facturer.{" "}
              <Link href="/factures" className="underline underline-offset-2 hover:text-brand">
                Voir les factures
              </Link>
            </p>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {orders.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune commande client dans cet espace. Créez une commande ou importez vos lignes XLSX
              avec le modèle téléchargeable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Commandes client de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Commande
                    </th>
                    <th scope="col" className={TH}>
                      Client
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Livraison prévue
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Total HT
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Livraison
                    </th>
                    <th scope="col" className={TH}>
                      Facturation
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {order.number ?? (
                          <span className="text-muted">{salesStatusLabel(order.status)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{order.customerName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {order.customerCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(order.orderDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {order.expectedDeliveryDate
                          ? isoDateLabel(order.expectedDeliveryDate)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(order.exTaxTotal)}
                      </td>
                      <td className="px-4 py-2.5">
                        <SalesStatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <DeliveryStateBadge state={order.deliveryState} />
                      </td>
                      <td className="px-4 py-2.5">
                        <InvoicingStateBadge state={order.invoicingState} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/ventes/${order.id}`}
                          aria-label={`Ouvrir la commande ${order.number ?? salesStatusLabel(order.status).toLowerCase()}`}
                          title="Ouvrir la commande"
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

        {orders.length === 200 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 200 commandes les plus récentes.
          </p>
        ) : null}
      </main>
    </div>
  );
}
