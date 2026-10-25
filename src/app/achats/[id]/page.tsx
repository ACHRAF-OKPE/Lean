import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Info, PackagePlus, ReceiptText } from "lucide-react";
import type { PurchaseOrderStatus, ReceptionStatus } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { PurchaseStatusBadge, ReceiptStateBadge } from "@/components/purchase-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { canApplyAction, statusLabel } from "@/modules/purchases/lifecycle";
import { getPurchaseOrder } from "@/modules/purchases/queries";
import { listInternalLocations } from "@/modules/stock/locations";
import { compareQuantity, formatQuantity } from "@/modules/stock/quantities";
import { CancelReceptionButton } from "./cancel-reception-button";
import { ReceptionForm } from "./reception-form";
import { TransitionButton } from "./transition-button";

export const metadata: Metadata = {
  title: "Commande fournisseur",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "draft",
  "requested",
  "confirmed",
  "closed",
  "cancelled",
];
const TH = "px-4 py-2.5 font-normal";

const RECEPTION_STATUS_META: Record<ReceptionStatus, { label: string; className: string }> = {
  validated: {
    label: "Validée",
    className: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  cancelled: {
    label: "Annulée",
    className: "border-line bg-canvas text-muted",
  },
};

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (typeof query.cree === "string") {
    return {
      tone: "success",
      text: "Commande créée en brouillon. Demandez puis confirmez la commande pour obtenir son numéro.",
    };
  }
  if (typeof query.maj === "string" && ORDER_STATUSES.includes(query.maj as PurchaseOrderStatus)) {
    return {
      tone: "success",
      text: `Statut mis à jour : ${statusLabel(query.maj as PurchaseOrderStatus)}.`,
    };
  }
  if (typeof query.recu === "string") {
    const warnings = Number.parseInt(String(query.avertissements ?? ""), 10);
    return {
      tone: warnings > 0 ? "warning" : "success",
      text:
        `Réception ${query.recu} enregistrée ; le stock et les quantités reçues sont à jour.` +
        (warnings > 0
          ? ` ${warnings} avertissement${warnings > 1 ? "s" : ""} de sur-réception a été enregistré.`
          : ""),
    };
  }
  if (typeof query.annulee === "string") {
    return {
      tone: "success",
      text: `Réception ${query.annulee} annulée par mouvement inverse ; l'entrée d'origine reste au journal.`,
    };
  }
  return null;
}

export default function PurchaseOrderPage(props: PageProps<"/achats/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la commande…" />}>
      <PurchaseOrderContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PurchaseOrderContent({
  params,
  searchParams,
}: Pick<PageProps<"/achats/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id: orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships, query] = await Promise.all([
    getPurchaseOrder(db, { tenantId: session.tenantId, orderId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!detail) {
    notFound();
  }

  const { order, lines, receptions, hasValidatedReception } = detail;
  const canWrite = can(session.role, "data.write");
  const hasReceivableLines = lines.some(
    (line) => line.articleType === "product" && line.receiptState !== "received",
  );
  const locations =
    canWrite && order.status === "confirmed"
      ? await listInternalLocations(db, session.tenantId)
      : [];
  const banner = bannerFor(query);
  const canReceiveNow = canWrite && order.status === "confirmed" && hasReceivableLines;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="purchases" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/achats"
            aria-label="Revenir aux achats"
            title="Revenir aux achats"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Commande fournisseur
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-medium tracking-tight">{order.number ?? "Brouillon"}</h1>
              <PurchaseStatusBadge status={order.status} />
              <ReceiptStateBadge state={order.receiptState} />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {order.supplierName} · <span className="font-mono">{order.supplierCode}</span> · créée
              le {isoDateLabel(order.orderDate)}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {canWrite && canApplyAction(order.status, "request") ? (
              <TransitionButton orderId={order.id} action="request" />
            ) : null}
            {canWrite && canApplyAction(order.status, "confirm") ? (
              <TransitionButton orderId={order.id} action="confirm" />
            ) : null}
            {canWrite && canApplyAction(order.status, "close") ? (
              <TransitionButton orderId={order.id} action="close" />
            ) : null}
            {canWrite && canApplyAction(order.status, "cancel") && !hasValidatedReception ? (
              <TransitionButton orderId={order.id} action="cancel" />
            ) : null}
            {canReceiveNow ? (
              <a
                href="#reception"
                aria-label="Saisir une réception"
                title="Saisir une réception"
                className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40"
              >
                <PackagePlus className="size-4" aria-hidden="true" />
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
            <dt className="text-[10px] text-muted">Réception prévue</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">
              {order.expectedReceiptDate ? isoDateLabel(order.expectedReceiptDate) : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Référence fournisseur</dt>
            <dd className="mt-1 truncate font-mono text-[11px]">
              {order.externalReference ?? "—"}
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
              <caption className="sr-only">Lignes de la commande fournisseur</caption>
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
                    Reçu
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Reste
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Prix unitaire
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total
                  </th>
                  <th scope="col" className={TH}>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const surplus = compareQuantity(line.receivedQty, line.qty) > 0;
                  return (
                    <tr key={line.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                        {String(line.lineNumber).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">
                          <span className="font-mono text-[10px] text-muted">
                            {line.articleCode}
                          </span>{" "}
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
                        {formatQuantity(line.receivedQty)}
                        {surplus ? (
                          <span className="ml-1 rounded-full border border-copper/20 bg-copper-soft px-1.5 py-0.5 text-[9px] text-copper">
                            Sur-réception
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.remainingQty)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(line.unitPriceXof)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(line.lineTotalXof)}
                      </td>
                      <td className="px-4 py-2.5">
                        <ReceiptStateBadge state={line.receiptState} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <ReceiptText className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Réceptions</h2>
            <span className="ml-auto font-mono text-[10px] text-muted">{receptions.length}</span>
          </div>

          {receptions.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              Aucune réception. La saisie devient possible une fois la commande confirmée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Réceptions de la commande</caption>
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
                  {receptions.map((reception) => {
                    const meta = RECEPTION_STATUS_META[reception.status];
                    return (
                      <tr key={reception.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                          {reception.number}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                          {isoDateLabel(reception.receivedDate)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{reception.locationName}</td>
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                          {reception.moveNumber ?? "—"}
                        </td>
                        <td className="max-w-64 truncate px-4 py-2.5 text-muted">
                          {reception.notes ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canWrite && reception.status === "validated" ? (
                            <div className="flex justify-end">
                              <CancelReceptionButton
                                orderId={order.id}
                                receptionId={reception.id}
                                number={reception.number}
                              />
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canWrite && order.status === "confirmed" ? (
          <ReceptionForm
            orderId={order.id}
            lines={lines}
            locations={locations}
            today={todayIsoDate()}
          />
        ) : null}

        {order.status === "draft" || order.status === "requested" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            La réception sera disponible après confirmation de la commande.
          </p>
        ) : null}
      </main>
    </div>
  );
}
