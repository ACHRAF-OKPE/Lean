"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, FilePlus2, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createInvoiceAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";
import { formatXof } from "@/lib/money";
import type { SalesOrderLineDetail } from "@/modules/sales/queries";
import { compareQuantity, computeLineTotal, formatQuantity } from "@/modules/stock/quantities";

function lineTotal(line: SalesOrderLineDetail, qty: string): number | null {
  const normalized = qty.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    return null;
  }
  try {
    const total = computeLineTotal(normalized, line.unitPriceXof);
    return Number.isSafeInteger(total) ? total : null;
  } catch {
    return null;
  }
}

export function InvoiceForm({
  orderId,
  lines,
  today,
  defaultDueDate,
}: {
  orderId: string;
  lines: readonly SalesOrderLineDetail[];
  today: string;
  defaultDueDate: string;
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, EMPTY_SALES_FORM_STATE);
  const billable = lines.filter((line) => compareQuantity(line.remainingToInvoice, "0") > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(billable.map((line) => [line.id, line.remainingToInvoice])),
  );
  const total = billable.reduce(
    (sum, line) => sum + (lineTotal(line, quantities[line.id] ?? "") ?? 0),
    0,
  );

  if (billable.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3 text-[11px] text-brand-strong">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        Toutes les lignes de cette commande sont intégralement facturées.
      </div>
    );
  }

  return (
    <form
      action={formAction}
      id="facturation"
      className="mt-4 scroll-mt-6 rounded-xl border border-line bg-panel p-5"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <FilePlus2 className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Préparer une facture</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Facture en brouillon : elle ne consomme rien tant qu&apos;elle n&apos;est pas validée. Un
        produit se facture sur les quantités livrées, un service sur les quantités commandées.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Facture de la commande</legend>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date de facture" htmlFor="invoiceDate" hint="Aujourd'hui ou passée.">
            <input
              id="invoiceDate"
              name="invoiceDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Échéance" htmlFor="dueDate" hint="Postérieure ou égale à la date.">
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              required
              defaultValue={defaultDueDate}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Notes" htmlFor="invoiceNotes" hint="1000 caractères maximum.">
            <input
              id="invoiceNotes"
              name="notes"
              maxLength={1000}
              placeholder="Référence de facturation"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="space-y-2">
          {billable.map((line) => (
            <div
              key={line.id}
              className="grid gap-3 rounded-lg border border-line bg-canvas px-3.5 py-3 md:grid-cols-[minmax(0,1fr)_10rem] md:items-center"
            >
              <input type="hidden" name="orderLineId" value={line.id} />
              <div>
                <p className="text-[11px] font-medium">
                  <span className="font-mono text-[10px] text-muted">{line.articleCode}</span>{" "}
                  {line.articleName}
                </p>
                <p className="mt-0.5 text-[10px] text-muted tabular-nums">
                  {line.articleType === "product"
                    ? `Livré ${formatQuantity(line.deliveredQty)}`
                    : `Commandé ${formatQuantity(line.qty)}`}{" "}
                  · déjà facturé {formatQuantity(line.invoicedQty)} · facturable{" "}
                  <span className="font-medium text-ink">
                    {formatQuantity(line.remainingToInvoice)}
                  </span>{" "}
                  {line.unitCode}
                </p>
              </div>
              <Field label="Quantité facturée" htmlFor={`facture-${line.id}`} hint={line.unitCode}>
                <input
                  id={`facture-${line.id}`}
                  name="quantite"
                  inputMode="decimal"
                  max={line.remainingToInvoice}
                  value={quantities[line.id] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: event.target.value,
                    }))
                  }
                  placeholder="0"
                  className={`${INPUT_CLASS} text-right tabular-nums`}
                />
              </Field>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <p className="text-[11px] text-muted">Total facture HT</p>
          <p className="font-mono text-sm font-medium tabular-nums">
            {Number.isSafeInteger(total) ? formatXof(total) : "—"}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer la facture en brouillon"
            title="Enregistrer en brouillon"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FilePlus2 className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
