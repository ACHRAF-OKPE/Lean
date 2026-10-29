"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ban, FileSignature, LoaderCircle, ShoppingCart } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import {
  dismissLineAction,
  generateOrdersAction,
  generateTenderAction,
} from "@/lib/supply/actions";
import { EMPTY_SUPPLY_FORM_STATE } from "@/lib/supply/form-state";
import type { SupplyDecision } from "@/db/schema";
import type { SupplyRunLineDetail } from "@/modules/supply/queries";
import { computeLineTotal, formatQuantity, quantityToMicros } from "@/modules/stock/quantities";

const TH = "px-3 py-2.5 font-normal";
const ICON_BUTTON =
  "grid size-9 place-items-center rounded-md border transition-colors disabled:opacity-50";
const SMALL_BUTTON =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const DECISION: Record<SupplyDecision, { label: string; className: string }> = {
  pending: { label: "En attente", className: "border-line bg-canvas text-muted" },
  ordered: { label: "Commandé", className: "border-brand/20 bg-brand-soft text-brand-strong" },
  tendered: { label: "En cotation", className: "border-brand/20 bg-brand-soft text-brand-strong" },
  dismissed: { label: "Écarté", className: "border-copper/20 bg-copper-soft text-copper" },
};

function DecisionBadge({ decision }: { decision: SupplyDecision }) {
  const entry = DECISION[decision];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

function DismissLineForm({
  runId,
  lineId,
  lineNumber,
}: {
  runId: string;
  lineId: string;
  lineNumber: number;
}) {
  const [state, formAction, pending] = useActionState(dismissLineAction, EMPTY_SUPPLY_FORM_STATE);
  return (
    <details className="relative">
      <summary
        aria-label={`Écarter la proposition ${lineNumber}`}
        title="Écarter la proposition"
        className={`${SMALL_BUTTON} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        <Ban className="size-3.5" aria-hidden="true" />
      </summary>
      <form
        action={formAction}
        className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-md border border-line bg-panel p-3 shadow-lg"
      >
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="lineId" value={lineId} />
        <label htmlFor={`dismiss-${lineId}`} className="block text-[10px] font-medium">
          Motif de l&apos;écart
        </label>
        <input
          id={`dismiss-${lineId}`}
          name="reason"
          required
          maxLength={500}
          placeholder="Stock suffisant, besoin abandonné…"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          aria-label={`Confirmer l'écart de la proposition ${lineNumber}`}
          title="Confirmer l'écart"
          className={`${SMALL_BUTTON} text-copper hover:border-copper/40 hover:text-copper`}
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Ban className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <FormErrors errors={state.errors} />
      </form>
    </details>
  );
}

export function ProposalWorkbench({
  runId,
  lines,
  canWrite,
  today,
  defaultDeadline,
}: {
  runId: string;
  lines: readonly SupplyRunLineDetail[];
  canWrite: boolean;
  today: string;
  defaultDeadline: string;
}) {
  const pendingIds = lines.filter((line) => line.decision === "pending").map((line) => line.id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(pendingIds));
  const [ordersState, ordersAction, ordersPending] = useActionState(
    generateOrdersAction,
    EMPTY_SUPPLY_FORM_STATE,
  );
  const [tenderState, tenderAction, tenderPending] = useActionState(
    generateTenderAction,
    EMPTY_SUPPLY_FORM_STATE,
  );

  const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
  const selectedCount = pendingIds.filter((id) => selected.has(id)).length;

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(() => new Set(allSelected ? [] : pendingIds));
  }

  if (lines.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-panel px-5 py-10 text-center text-[11px] leading-5 text-muted">
        Aucune proposition sur ce calcul : le stock projeté couvre le seuil sur tout l&apos;horizon.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canWrite && pendingIds.length > 0 ? (
        <div className="grid gap-3 rounded-xl border border-line bg-panel px-4 py-4 md:grid-cols-2 md:px-5">
          <form action={ordersAction} className="space-y-2">
            <input type="hidden" name="runId" value={runId} />
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="lineId" value={id} />
            ))}
            <p className="text-[11px] font-medium">
              Commandes fournisseurs ({selectedCount} proposition{selectedCount > 1 ? "s" : ""})
            </p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[10px]">
                <input
                  type="radio"
                  name="grouping"
                  value="supplier"
                  defaultChecked
                  className="size-3.5 accent-brand"
                />
                Un bon brouillon par fournisseur
              </label>
              <label className="flex items-center gap-2 text-[10px]">
                <input
                  type="radio"
                  name="grouping"
                  value="supplier_date"
                  className="size-3.5 accent-brand"
                />
                Un bon par fournisseur et date de besoin
              </label>
            </div>
            <button
              type="submit"
              disabled={ordersPending || selectedCount === 0}
              aria-label="Générer les commandes des propositions sélectionnées"
              title="Générer les commandes"
              className={`${ICON_BUTTON} border-transparent bg-brand text-white hover:opacity-90`}
            >
              {ordersPending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShoppingCart className="size-4" aria-hidden="true" />
              )}
            </button>
            <FormErrors errors={ordersState.errors} />
          </form>

          <form action={tenderAction} className="space-y-2 md:border-l md:border-line md:pl-4">
            <input type="hidden" name="runId" value={runId} />
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="lineId" value={id} />
            ))}
            <p className="text-[11px] font-medium">Demande de cotation</p>
            <label htmlFor="supply-deadline" className="block text-[10px]">
              Échéance de cotation
            </label>
            <input
              id="supply-deadline"
              type="date"
              name="deadline"
              min={today}
              defaultValue={defaultDeadline}
              className={INPUT_CLASS}
            />
            <button
              type="submit"
              disabled={tenderPending || selectedCount === 0}
              aria-label="Créer une demande de cotation depuis les propositions sélectionnées"
              title="Créer une demande de cotation"
              className={`${ICON_BUTTON} border-line bg-panel text-brand hover:border-brand/40`}
            >
              {tenderPending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSignature className="size-4" aria-hidden="true" />
              )}
            </button>
            <p className="text-[10px] leading-4 text-muted">
              Le brouillon invite chaque fournisseur retenu ; l&apos;envoi reste une action
              distincte.
            </p>
            <FormErrors errors={tenderState.errors} />
          </form>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <caption className="sr-only">Propositions d&apos;achat du calcul</caption>
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                {canWrite ? (
                  <th scope="col" className={`${TH} w-8`}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={pendingIds.length === 0}
                      aria-label="Sélectionner toutes les propositions en attente"
                      className="size-3.5 accent-brand"
                    />
                  </th>
                ) : null}
                <th scope="col" className={TH}>
                  Ligne
                </th>
                <th scope="col" className={TH}>
                  Article
                </th>
                <th scope="col" className={TH}>
                  Fournisseur
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Stock
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Entrées
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Sorties
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Projeté
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Seuil
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Proposition
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Montant
                </th>
                <th scope="col" className={TH}>
                  Besoin
                </th>
                <th scope="col" className={TH}>
                  À commander
                </th>
                <th scope="col" className={TH}>
                  État
                </th>
                {canWrite ? (
                  <th scope="col" className={`${TH} text-right`}>
                    Action
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-b-0">
                  {canWrite ? (
                    <td className="px-3 py-2.5">
                      {line.decision === "pending" ? (
                        <input
                          type="checkbox"
                          checked={selected.has(line.id)}
                          onChange={() => toggle(line.id)}
                          aria-label={`Sélectionner la proposition ${line.lineNumber}`}
                          className="size-3.5 accent-brand"
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5 text-muted tabular-nums">{line.lineNumber}</td>
                  <td className="px-3 py-2.5">
                    <span className="block font-mono text-[10px] text-muted">
                      {line.articleCode}
                    </span>
                    <span className="block max-w-48 truncate font-medium">{line.articleName}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block font-mono text-[10px] text-muted">
                      {line.supplierCode}
                    </span>
                    <span className="block max-w-40 truncate">{line.supplierName}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatQuantity(line.stockQty)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatQuantity(line.incomingQty)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatQuantity(line.outgoingQty)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums ${
                      quantityToMicros(line.projectedQty) < quantityToMicros(line.minStockQty)
                        ? "text-copper"
                        : ""
                    }`}
                  >
                    {formatQuantity(line.projectedQty)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted tabular-nums">
                    {formatQuantity(line.minStockQty)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {formatQuantity(line.proposedQty)} {line.unitCode}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="block">{formatXof(line.purchasePriceXof)}</span>
                    <span className="block font-mono text-[10px] text-muted">
                      {formatXof(computeLineTotal(line.proposedQty, line.purchasePriceXof))}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {isoDateLabel(line.needDate)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    <span className="block">{isoDateLabel(line.orderDate)}</span>
                    {line.late ? (
                      <span className="block text-[10px] text-copper">Délai dépassé</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <DecisionBadge decision={line.decision} />
                    {line.decisionReason ? (
                      <span className="mt-0.5 block max-w-40 truncate text-[10px] text-muted">
                        {line.decisionReason}
                      </span>
                    ) : null}
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {line.convertedDocumentId ? (
                          <Link
                            href={
                              line.decision === "ordered"
                                ? `/achats/${line.convertedDocumentId}`
                                : `/achats/appels-offres/${line.convertedDocumentId}`
                            }
                            aria-label={`Ouvrir le document créé depuis la proposition ${line.lineNumber}`}
                            title="Ouvrir le document"
                            className={SMALL_BUTTON}
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        ) : null}
                        {line.decision === "pending" ? (
                          <DismissLineForm
                            runId={runId}
                            lineId={line.id}
                            lineNumber={line.lineNumber}
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
