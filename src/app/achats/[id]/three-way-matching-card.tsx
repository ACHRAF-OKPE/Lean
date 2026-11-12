"use client";

import { useActionState, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { PurchaseOrderDetail, PurchaseOrderLineDetail } from "@/modules/purchases/queries";
import { recordSupplierInvoiceAction, resolveMatchingDisputeAction } from "@/lib/purchases/actions";
import { type PurchaseFormState, EMPTY_PURCHASE_FORM_STATE } from "@/lib/purchases/form-state";
import { formatXof } from "@/lib/money";
import { formatQuantity } from "@/modules/stock/quantities";
import { type PurchaseOrderMatchingStatus } from "@/modules/purchases/matching";

interface Props {
  readonly order: PurchaseOrderDetail["order"];
  readonly lines: readonly PurchaseOrderLineDetail[];
  readonly canWrite: boolean;
  readonly today: string;
}

const STATUS_BADGE: Record<
  PurchaseOrderMatchingStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  unmatched: {
    label: "Non rapproché",
    className: "border-line bg-canvas text-muted",
    icon: Clock,
  },
  matched: {
    label: "Conforme — Bon à payer certifié",
    className: "border-brand/20 bg-brand-soft text-brand-strong font-medium",
    icon: ShieldCheck,
  },
  quantity_mismatch: {
    label: "Écart de quantité — Paiement bloqué",
    className: "border-rose-300 bg-rose-50 text-rose-800 font-medium",
    icon: ShieldAlert,
  },
  price_mismatch: {
    label: "Écart de prix — Paiement bloqué",
    className: "border-amber-300 bg-amber-50 text-amber-800 font-medium",
    icon: AlertTriangle,
  },
  pending_receipt: {
    label: "En attente de réception magasin",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    icon: Clock,
  },
  disputed: {
    label: "En litige — Écarts multiples",
    className: "border-rose-300 bg-rose-50 text-rose-800 font-medium",
    icon: ShieldAlert,
  },
};

export function ThreeWayMatchingCard({ order, lines, canWrite, today }: Props) {
  const [recordState, recordAction, isPendingRecord] = useActionState<PurchaseFormState, FormData>(
    recordSupplierInvoiceAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const [resolveState, resolveAction, isPendingResolve] = useActionState<
    PurchaseFormState,
    FormData
  >(resolveMatchingDisputeAction, EMPTY_PURCHASE_FORM_STATE);

  const [invoiceNumber, setInvoiceNumber] = useState(order.supplierInvoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(order.supplierInvoiceDate ?? today);
  const [showForm, setShowForm] = useState(!order.supplierInvoiceNumber);
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  // Valeurs locales pour la saisie des lignes
  const [lineInputs, setLineInputs] = useState<Record<string, { qty: string; unitPrice: number }>>(
    () => {
      const initial: Record<string, { qty: string; unitPrice: number }> = {};
      for (const line of lines) {
        // Si un matching précédent existe, on le recharge
        const prevMatching = order.matchingLines?.find((m) => m.orderLineId === line.id);
        initial[line.id] = {
          qty: prevMatching
            ? prevMatching.invoicedQty
            : line.receivedQty !== "0"
              ? line.receivedQty
              : line.qty,
          unitPrice: prevMatching ? prevMatching.invoicedUnitPriceXof : line.unitPriceXof,
        };
      }
      return initial;
    },
  );

  const badgeMeta = STATUS_BADGE[order.matchingStatus];
  const StatusIcon = badgeMeta.icon;

  function updateLineQty(lineId: string, val: string) {
    setLineInputs((prev) => ({
      ...prev,
      [lineId]: {
        qty: val,
        unitPrice: prev[lineId]?.unitPrice ?? 0,
      },
    }));
  }

  function updateLinePrice(lineId: string, val: number) {
    setLineInputs((prev) => ({
      ...prev,
      [lineId]: {
        qty: prev[lineId]?.qty ?? "0",
        unitPrice: val,
      },
    }));
  }

  function prefillFromReceptions() {
    const updated: Record<string, { qty: string; unitPrice: number }> = {};
    for (const line of lines) {
      updated[line.id] = {
        qty: line.receivedQty,
        unitPrice: line.unitPriceXof,
      };
    }
    setLineInputs(updated);
  }

  function prefillFromOrder() {
    const updated: Record<string, { qty: string; unitPrice: number }> = {};
    for (const line of lines) {
      updated[line.id] = {
        qty: line.qty,
        unitPrice: line.unitPriceXof,
      };
    }
    setLineInputs(updated);
  }

  const linesJson = JSON.stringify(
    lines.map((line) => ({
      orderLineId: line.id,
      invoicedQty: lineInputs[line.id]?.qty || "0",
      invoicedUnitPriceXof: lineInputs[line.id]?.unitPrice ?? line.unitPriceXof,
    })),
  );

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <FileCheck2 className="size-4 text-brand" aria-hidden="true" />
          <h2 className="text-sm font-semibold">
            Rapprochement tripartite (3-Way Match) & Bon à Payer
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${badgeMeta.className}`}
          >
            <StatusIcon className="size-3.5" aria-hidden="true" />
            {badgeMeta.label}
          </span>
          {order.supplierInvoiceNumber && canWrite ? (
            <button
              type="button"
              onClick={() => setShowForm((prev) => !prev)}
              className="text-xs text-muted underline hover:text-brand"
            >
              {showForm ? "Masquer formulaire" : "Modifier facture"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Résumé de rapprochement si déjà effectué */}
      {order.supplierInvoiceNumber ? (
        <div className="border-b border-line bg-canvas/30 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-line bg-panel p-3">
              <span className="text-[10px] text-muted">Facture fournisseur</span>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
                {order.supplierInvoiceNumber}
              </p>
              <p className="text-[10px] text-muted">du {order.supplierInvoiceDate ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3">
              <span className="text-[10px] text-muted">Montant facturé</span>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
                {formatXof(order.supplierInvoiceAmountXof ?? 0)}
              </p>
              <p className="text-[10px] text-muted">Commandé : {formatXof(order.exTaxTotal)}</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3">
              <span className="text-[10px] text-muted">Certifié par</span>
              <p className="mt-0.5 text-xs font-medium text-ink">
                {order.matchedByName ?? "Système automatique"}
              </p>
              <p className="text-[10px] text-muted">
                {order.matchedAt ? new Date(order.matchedAt).toLocaleDateString("fr-FR") : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3">
              <span className="text-[10px] text-muted">Autorisation de paiement</span>
              <p className="mt-0.5 text-xs font-semibold">
                {order.matchingStatus === "matched" ? (
                  <span className="text-brand">Accordée (Bon à Payer)</span>
                ) : (
                  <span className="text-rose-700">Bloquée (Litige en cours)</span>
                )}
              </p>
              {order.matchingStatus !== "matched" && canWrite ? (
                <button
                  type="button"
                  onClick={() => setShowDisputeModal(true)}
                  className="mt-1 text-[11px] font-medium text-copper hover:underline"
                >
                  Résoudre / Dérogation...
                </button>
              ) : null}
            </div>
          </div>

          {order.disputeNotes ? (
            <p className="mt-3 rounded-md border border-line bg-panel p-2.5 text-[11px] leading-relaxed text-muted">
              <strong className="text-ink">Note de litige / résolution :</strong>{" "}
              {order.disputeNotes}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Formulaire de saisie & contrôle Ligne par Ligne */}
      {showForm && canWrite ? (
        <form action={recordAction} className="p-5">
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="linesJson" value={linesJson} />

          {recordState.errors && recordState.errors.length > 0 ? (
            <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">
              {recordState.errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label
                  htmlFor="supplierInvoiceNumber"
                  className="block text-xs font-medium text-muted"
                >
                  N° Facture Fournisseur *
                </label>
                <input
                  id="supplierInvoiceNumber"
                  name="supplierInvoiceNumber"
                  type="text"
                  required
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Ex : FAC-2026-9041"
                  className="mt-1 block w-48 rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink placeholder:text-muted/50 focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="supplierInvoiceDate"
                  className="block text-xs font-medium text-muted"
                >
                  Date de Facture *
                </label>
                <input
                  id="supplierInvoiceDate"
                  name="supplierInvoiceDate"
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="mt-1 block rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            {/* Raccourcis de remplissage rapide */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] text-muted">Remplissage express :</span>
              <button
                type="button"
                onClick={prefillFromReceptions}
                className="rounded border border-line bg-canvas px-2 py-1 text-[11px] hover:border-brand/40 hover:text-brand"
              >
                Copier réceptions réelles
              </button>
              <button
                type="button"
                onClick={prefillFromOrder}
                className="rounded border border-line bg-canvas px-2 py-1 text-[11px] hover:border-brand/40 hover:text-brand"
              >
                Copier commande initiale
              </button>
            </div>
          </div>

          {/* Tableau comparatif */}
          <div className="mt-5 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas/40 font-mono text-[10px] tracking-wider text-muted uppercase">
                <tr>
                  <th className="px-3 py-2">Article</th>
                  <th className="px-3 py-2 text-right">Commandé</th>
                  <th className="px-3 py-2 text-right">Reçu magasin</th>
                  <th className="px-3 py-2 text-right">Qté Facturée</th>
                  <th className="px-3 py-2 text-right">Prix Facturé (XOF)</th>
                  <th className="px-3 py-2 text-right">Total Ligne</th>
                  <th className="px-3 py-2 text-center">Conformité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((line) => {
                  const input = lineInputs[line.id] || {
                    qty: line.qty,
                    unitPrice: line.unitPriceXof,
                  };
                  const invoicedQty = parseFloat(input.qty) || 0;
                  const receivedQty = parseFloat(line.receivedQty) || 0;
                  const lineTotal = Math.round(invoicedQty * input.unitPrice);

                  // Statut visuel
                  const isQtyMatch = line.articleType === "service" || invoicedQty <= receivedQty;
                  const isPriceMatch = input.unitPrice <= line.unitPriceXof;
                  const isLineConform = isQtyMatch && isPriceMatch;

                  return (
                    <tr key={line.id} className="hover:bg-canvas/20">
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{line.articleName}</span>
                        <span className="ml-1 font-mono text-[10px] text-muted">
                          ({line.unitCode})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted tabular-nums">
                        {formatQuantity(line.qty)} × {formatXof(line.unitPriceXof)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted tabular-nums">
                        {line.articleType === "service"
                          ? "Service"
                          : formatQuantity(line.receivedQty)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={input.qty}
                          onChange={(e) => updateLineQty(line.id, e.target.value)}
                          className="w-20 rounded border border-line bg-panel px-2 py-1 text-right font-mono text-xs text-ink focus:border-brand focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={input.unitPrice}
                          onChange={(e) =>
                            updateLinePrice(line.id, parseInt(e.target.value, 10) || 0)
                          }
                          className="w-28 rounded border border-line bg-panel px-2 py-1 text-right font-mono text-xs text-ink focus:border-brand focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-ink tabular-nums">
                        {formatXof(lineTotal)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isLineConform ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-brand">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
                            <AlertTriangle className="size-3.5" aria-hidden="true" />
                            {!isQtyMatch ? "Surfacturé" : "Surcoût"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[11px] text-muted">
              Le rapprochement compare automatiquement les entrées magasin et le bon de commande. Si
              conforme, le Bon à Payer est délivré instantanément.
            </p>
            <button
              type="submit"
              disabled={isPendingRecord}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-strong disabled:opacity-50"
            >
              <FileCheck2 className="size-4" aria-hidden="true" />
              {isPendingRecord ? "Calcul du 3-Way Match..." : "Valider le rapprochement & BAP"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Modal / Zone de résolution de litige */}
      {showDisputeModal ? (
        <div className="border-t border-line bg-canvas/40 p-5">
          <form action={resolveAction} className="max-w-xl">
            <input type="hidden" name="orderId" value={order.id} />
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-ink">
                Résolution de litige par dérogation
              </h3>
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="text-xs text-muted hover:text-ink"
              >
                Fermer
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Indiquez le motif de régularisation (ex : « Avoir reçu N° AV-12 », « Tolérance
              accordée par la direction ») pour débloquer le bon à payer.
            </p>
            {resolveState.errors && resolveState.errors.length > 0 ? (
              <p className="mt-2 text-xs text-rose-700">{resolveState.errors[0]}</p>
            ) : null}
            <textarea
              name="resolutionNotes"
              rows={2}
              required
              placeholder="Motif de résolution..."
              className="mt-2 block w-full rounded-md border border-line bg-panel p-2.5 text-xs text-ink focus:border-brand focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-panel"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isPendingResolve}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {isPendingResolve ? "Déblocage..." : "Débloquer le Bon à Payer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
