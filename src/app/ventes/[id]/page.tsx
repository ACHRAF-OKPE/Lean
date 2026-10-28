import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, FilePlus2, Info, ReceiptText, Truck } from "lucide-react";
import type { SalesOrderStatus } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { DiscussionPanel } from "@/components/discussion-panel";
import { DocumentTasks } from "@/components/document-tasks";
import { LoadingShell } from "@/components/loading-shell";
import {
  DeliveryStateBadge,
  DeliveryStatusBadge,
  InvoiceStatusBadge,
  InvoicingStateBadge,
  SalesStatusBadge,
} from "@/components/sales-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { canApplySalesAction, salesStatusLabel } from "@/modules/sales/lifecycle";
import { getSalesOrder } from "@/modules/sales/queries";
import { listInternalLocations } from "@/modules/stock/locations";
import { compareQuantity, formatQuantity } from "@/modules/stock/quantities";
import { CancelDeliveryButton } from "./cancel-delivery-button";
import { DeliveryForm } from "./delivery-form";
import { InvoiceForm } from "./invoice-form";
import { TransitionButton } from "./transition-button";

export const metadata: Metadata = {
  title: "Commande client",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_STATUSES: readonly SalesOrderStatus[] = ["draft", "confirmed", "closed", "cancelled"];
const TH = "px-4 py-2.5 font-normal";

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (typeof query.cree === "string") {
    const warnings = Number.parseInt(String(query.avertissements ?? ""), 10);
    return {
      tone: warnings > 0 ? "warning" : "success",
      text:
        "Commande créée en brouillon. Confirmez-la pour obtenir son numéro." +
        (warnings > 0
          ? ` ${warnings} avertissement${warnings > 1 ? "s" : ""} de contrôle a été enregistré.`
          : ""),
    };
  }
  if (typeof query.maj === "string" && ORDER_STATUSES.includes(query.maj as SalesOrderStatus)) {
    return {
      tone: "success",
      text: `Statut mis à jour : ${salesStatusLabel(query.maj as SalesOrderStatus)}.`,
    };
  }
  if (typeof query.livraison === "string") {
    return {
      tone: "success",
      text: `Livraison ${query.livraison} enregistrée ; le stock et les quantités livrées sont à jour.`,
    };
  }
  if (typeof query.livraison_annulee === "string") {
    return {
      tone: "success",
      text: `Livraison ${query.livraison_annulee} annulée par mouvement inverse ; la sortie d'origine reste au journal.`,
    };
  }
  return null;
}

export default function SalesOrderPage(props: PageProps<"/ventes/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la commande…" />}>
      <SalesOrderContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SalesOrderContent({
  params,
  searchParams,
}: Pick<PageProps<"/ventes/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id: orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships, query] = await Promise.all([
    getSalesOrder(db, { tenantId: session.tenantId, orderId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!detail) {
    notFound();
  }

  const { order, lines, deliveries, invoices, hasValidatedDelivery, hasValidatedInvoice } = detail;
  const canWrite = can(session.role, "data.write");
  const hasDeliverableLines = lines.some(
    (line) => line.articleType === "product" && compareQuantity(line.remainingToDeliver, "0") > 0,
  );
  const hasBillableLines = lines.some((line) => compareQuantity(line.remainingToInvoice, "0") > 0);
  const locations =
    canWrite && order.status === "confirmed"
      ? await listInternalLocations(db, session.tenantId)
      : [];
  const banner = bannerFor(query);
  const canDeliverNow = canWrite && order.status === "confirmed" && hasDeliverableLines;
  const canInvoiceNow = canWrite && order.status === "confirmed" && hasBillableLines;

  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + 30);
  const defaultDueDate = todayIsoDate(dueDate);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="sales" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/ventes"
            aria-label="Revenir aux ventes"
            title="Revenir aux ventes"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Commande client
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-medium tracking-tight">
                {order.number ?? salesStatusLabel(order.status)}
              </h1>
              <SalesStatusBadge status={order.status} />
              <DeliveryStateBadge state={order.deliveryState} />
              <InvoicingStateBadge state={order.invoicingState} />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {order.customerName} · <span className="font-mono">{order.customerCode}</span> · créée
              le {isoDateLabel(order.orderDate)}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {canWrite && canApplySalesAction(order.status, "confirm") ? (
              <TransitionButton orderId={order.id} action="confirm" />
            ) : null}
            {canWrite && canApplySalesAction(order.status, "close") ? (
              <TransitionButton orderId={order.id} action="close" />
            ) : null}
            {canWrite &&
            canApplySalesAction(order.status, "cancel") &&
            !hasValidatedDelivery &&
            !hasValidatedInvoice ? (
              <TransitionButton orderId={order.id} action="cancel" />
            ) : null}
            {canDeliverNow ? (
              <a
                href="#livraison"
                aria-label="Saisir une livraison"
                title="Saisir une livraison"
                className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40"
              >
                <Truck className="size-4" aria-hidden="true" />
              </a>
            ) : null}
            {canInvoiceNow ? (
              <a
                href="#facturation"
                aria-label="Préparer une facture"
                title="Préparer une facture"
                className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40"
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className={`mt-4 rounded-md border px-3 py-2 text-[11px] leading-5 ${
              banner.tone === "warning"
                ? "border-copper/20 bg-copper-soft text-copper"
                : "border-brand/20 bg-brand-soft text-brand-strong"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Total HT</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{formatXof(order.exTaxTotal)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Livraison prévue</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">
              {order.expectedDeliveryDate ? isoDateLabel(order.expectedDeliveryDate) : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Incoterm · référence client</dt>
            <dd className="mt-1 truncate font-mono text-[11px]">
              {order.incoterm ?? "—"}
              {order.externalReference ? ` · ${order.externalReference}` : ""}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Confirmée le</dt>
            <dd className="mt-1 text-[11px] font-medium">
              {order.confirmedAt
                ? new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "short",
                    timeZone: "Africa/Abidjan",
                  }).format(order.confirmedAt)
                : "—"}
            </dd>
          </div>
        </dl>

        {order.notes ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
            <p className="whitespace-pre-line">{order.notes}</p>
          </div>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Lignes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de la commande client</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Ligne
                  </th>
                  <th scope="col" className={TH}>
                    Article
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Commandé
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Livré
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Reliquat
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Facturé
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Reste à facturer
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Prix unitaire
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                      {String(line.lineNumber).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">
                        <span className="font-mono text-[10px] text-muted">{line.articleCode}</span>{" "}
                        {line.articleName}
                      </span>
                      <span className="text-[10px] text-muted">
                        {line.articleType === "service" ? "Service" : "Produit"} · {line.unitCode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(line.qty)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {line.articleType === "service" ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          <span className="block">{formatQuantity(line.deliveredQty)}</span>
                          <DeliveryStateBadge state={line.deliveryState} />
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {line.articleType === "service"
                        ? "—"
                        : formatQuantity(line.remainingToDeliver)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      <span className="block">{formatQuantity(line.invoicedQty)}</span>
                      <InvoicingStateBadge state={line.invoicingState} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(line.remainingToInvoice)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatXof(line.unitPriceXof)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatXof(line.lineTotalXof)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Truck className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Livraisons</h2>
            <span className="ml-auto font-mono text-[10px] text-muted">{deliveries.length}</span>
          </div>

          {deliveries.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              Aucune livraison. La saisie devient possible une fois la commande confirmée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Livraisons de la commande</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Numéro
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Emplacement
                    </th>
                    <th scope="col" className={TH}>
                      Mouvement
                    </th>
                    <th scope="col" className={TH}>
                      Notes
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {delivery.number}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(delivery.deliveredDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{delivery.locationName}</td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                        {delivery.moveNumber ?? "—"}
                      </td>
                      <td className="max-w-64 truncate px-4 py-2.5 text-muted">
                        {delivery.notes ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <DeliveryStatusBadge status={delivery.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canWrite && delivery.status === "validated" ? (
                          <div className="flex justify-end">
                            <CancelDeliveryButton
                              orderId={order.id}
                              deliveryId={delivery.id}
                              number={delivery.number}
                            />
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <ReceiptText className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Factures</h2>
            <span className="ml-auto font-mono text-[10px] text-muted">{invoices.length}</span>
          </div>

          {invoices.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              Aucune facture. Préparez un brouillon depuis les quantités facturables restantes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Factures de la commande</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Numéro
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
                          <ReceiptText className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canWrite && order.status === "confirmed" ? (
          <DeliveryForm
            key={lines
              .map((line) => `${line.id}:${line.deliveredQty}:${line.remainingToDeliver}`)
              .join("|")}
            orderId={order.id}
            lines={lines}
            locations={locations}
            today={todayIsoDate()}
          />
        ) : null}

        {canWrite && order.status === "confirmed" ? (
          <InvoiceForm
            key={lines
              .map((line) => `${line.id}:${line.invoicedQty}:${line.remainingToInvoice}`)
              .join("|")}
            orderId={order.id}
            lines={lines}
            today={todayIsoDate()}
            defaultDueDate={defaultDueDate}
          />
        ) : null}

        {order.status === "draft" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            La livraison et la facturation seront disponibles après confirmation de la commande.
          </p>
        ) : null}

        <DocumentTasks
          session={session}
          entityType="sales_order"
          entityId={order.id}
          label={order.number ?? "Vente en brouillon"}
        />
        <DiscussionPanel session={session} entityType="sales_order" entityId={order.id} />
      </main>
    </div>
  );
}
