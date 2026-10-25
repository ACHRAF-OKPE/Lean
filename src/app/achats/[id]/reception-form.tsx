"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, LoaderCircle, PackagePlus } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createReceptionAction } from "@/lib/purchases/actions";
import { EMPTY_PURCHASE_FORM_STATE } from "@/lib/purchases/form-state";
import { formatQuantity } from "@/modules/stock/quantities";
import type { LocationOption } from "@/modules/stock/locations";
import type { PurchaseOrderLineDetail } from "@/modules/purchases/queries";

export function ReceptionForm({
  orderId,
  lines,
  locations,
  today,
}: {
  orderId: string;
  lines: readonly PurchaseOrderLineDetail[];
  locations: readonly LocationOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    createReceptionAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const receivable = lines.filter(
    (line) => line.articleType === "product" && line.receiptState !== "received",
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      receivable.map((line) => [line.id, line.remainingQty === "0" ? "" : line.remainingQty]),
    ),
  );

  if (receivable.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3 text-[11px] text-brand-strong">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        Toutes les lignes marchandise de cette commande sont intégralement reçues.
      </div>
    );
  }

  return (
    <form
      action={formAction}
      id="reception"
      className="mt-4 scroll-mt-6 rounded-xl border border-line bg-panel p-5"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <PackagePlus className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Saisir une réception</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Écriture unique : bon de réception, mouvement d&apos;entrée, stock et quantités reçues. Les
        lignes laissées vides ne sont pas réceptionnées.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Réception de la commande</legend>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date de réception" htmlFor="receivedDate" hint="Aujourd'hui ou passée.">
            <input
              id="receivedDate"
              name="receivedDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Emplacement" htmlFor="locationId" hint="Emplacement interne actif.">
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
          <Field label="Notes" htmlFor="receptionNotes" hint="1000 caractères maximum.">
            <input
              id="receptionNotes"
              name="notes"
              maxLength={1000}
              placeholder="Bon de livraison fournisseur"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="space-y-2">
          {receivable.map((line) => (
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
                  Commandé {formatQuantity(line.qty)} {line.unitCode} · déjà reçu{" "}
                  {formatQuantity(line.receivedQty)} · reste{" "}
                  <span className="font-medium text-ink">{formatQuantity(line.remainingQty)}</span>
                </p>
              </div>
              <Field label="Quantité reçue" htmlFor={`qty-${line.id}`} hint={line.unitCode}>
                <input
                  id={`qty-${line.id}`}
                  name="quantite"
                  inputMode="decimal"
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
          Une quantité supérieure au reste à recevoir est acceptée et signalée ; une ligne déjà
          intégralement reçue refuse toute réception supplémentaire.
        </p>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer la réception"
            title="Enregistrer la réception"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <PackagePlus className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
