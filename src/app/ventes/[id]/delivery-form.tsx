"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, LoaderCircle, Truck } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createDeliveryAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";
import type { SalesOrderLineDetail } from "@/modules/sales/queries";
import type { LocationOption } from "@/modules/stock/locations";
import { compareQuantity, formatQuantity } from "@/modules/stock/quantities";

export function DeliveryForm({
  orderId,
  lines,
  locations,
  today,
}: {
  orderId: string;
  lines: readonly SalesOrderLineDetail[];
  locations: readonly LocationOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(createDeliveryAction, EMPTY_SALES_FORM_STATE);
  const deliverable = lines.filter(
    (line) => line.articleType === "product" && compareQuantity(line.remainingToDeliver, "0") > 0,
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(deliverable.map((line) => [line.id, line.remainingToDeliver])),
  );

  if (deliverable.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3 text-[11px] text-brand-strong">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        Toutes les lignes marchandise de cette commande sont intégralement livrées.
      </div>
    );
  }

  return (
    <form
      action={formAction}
      id="livraison"
      className="mt-4 scroll-mt-6 rounded-xl border border-line bg-panel p-5"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <Truck className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Saisir une livraison</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Écriture unique : bon de livraison, mouvement de sortie, stock et quantités livrées. La
        quantité ne peut jamais dépasser le reliquat et le stock disponible est vérifié.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Livraison de la commande</legend>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date de livraison" htmlFor="deliveredDate" hint="Aujourd'hui ou passée.">
            <input
              id="deliveredDate"
              name="deliveredDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Emplacement source" htmlFor="locationId" hint="Emplacement interne actif.">
            <select
              id="locationId"
              name="locationId"
              required
              defaultValue={locations[0]?.id ?? ""}
              className={INPUT_CLASS}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="deliveryNotes" hint="1000 caractères maximum.">
            <input
              id="deliveryNotes"
              name="notes"
              maxLength={1000}
              placeholder="Bon de livraison client"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="space-y-2">
          {deliverable.map((line) => (
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
                  Commandé {formatQuantity(line.qty)} {line.unitCode} · déjà livré{" "}
                  {formatQuantity(line.deliveredQty)} · reliquat{" "}
                  <span className="font-medium text-ink">
                    {formatQuantity(line.remainingToDeliver)}
                  </span>
                </p>
              </div>
              <Field label="Quantité livrée" htmlFor={`qty-${line.id}`} hint={line.unitCode}>
                <input
                  id={`qty-${line.id}`}
                  name="quantite"
                  inputMode="decimal"
                  max={line.remainingToDeliver}
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

        <p className="text-[10px] leading-4 text-muted">
          Une quantité supérieure au reliquat est refusée. Une ligne laissée vide n&apos;est pas
          livrée.
        </p>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer la livraison"
            title="Enregistrer la livraison"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Truck className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
