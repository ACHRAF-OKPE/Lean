import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, FileSignature, ShoppingCart } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { PurchaseStatusBadge, ReceiptStateBadge } from "@/components/purchase-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { statusLabel } from "@/modules/purchases/lifecycle";
import { getPurchaseOrderStats, listPurchaseOrders } from "@/modules/purchases/queries";

export const metadata: Metadata = {
  title: "Achats",
};

const TH = "px-4 py-2.5 font-normal";

export default function PurchasesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des achats…" />}>
      <PurchasesContent />
    </Suspense>
  );
}

async function PurchasesContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [orders, stats, memberships] = await Promise.all([
    listPurchaseOrders(db, session.tenantId),
    getPurchaseOrderStats(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="purchases" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Achats</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Commandes fournisseur</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Du brouillon à la réception. Chaque confirmation attribue un numéro, chaque réception
              écrit un mouvement de stock dans le même instant.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {orders.length} commande{orders.length > 1 ? "s" : ""}
            </span>
            <Link
              href="/achats/appels-offres"
              aria-label="Ouvrir les appels d'offres"
              title="Appels d'offres"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <FileSignature className="size-4" aria-hidden="true" />
            </Link>
            <CatalogActions kind="purchase_lines" />
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Commandes ouvertes</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{stats.open}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">En attente de réception</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">
              {stats.awaitingReceipt}
            </dd>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <ShoppingCart className="size-4 text-brand" aria-hidden="true" />
            <p className="text-[10px] leading-4 text-muted">
              Les lignes de service ne créent jamais de mouvement de stock.
            </p>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {orders.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune commande dans cet espace. Créez une commande ou importez vos lignes XLSX avec
              le modèle téléchargeable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Commandes fournisseur de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Commande
                    </th>
                    <th scope="col" className={TH}>
                      Fournisseur
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Réception prévue
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Total HT
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Réception
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
                          <span className="text-muted">{statusLabel(order.status)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{order.supplierName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {order.supplierCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(order.orderDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {order.expectedReceiptDate ? isoDateLabel(order.expectedReceiptDate) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(order.exTaxTotal)}
                      </td>
                      <td className="px-4 py-2.5">
                        <PurchaseStatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ReceiptStateBadge state={order.receiptState} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/achats/${order.id}`}
                          aria-label={`Ouvrir la commande ${order.number ?? statusLabel(order.status).toLowerCase()}`}
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
