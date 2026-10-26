"use client";

import { useActionState } from "react";
import { Banknote, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createPaymentAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";
import { formatXof } from "@/lib/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/modules/sales/payment-methods";

export function PaymentForm({
  invoiceId,
  balanceXof,
  today,
}: {
  invoiceId: string;
  balanceXof: number;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(createPaymentAction, EMPTY_SALES_FORM_STATE);

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <Banknote className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Enregistrer un règlement</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Solde restant {formatXof(balanceXof)}. Le montant ne peut pas dépasser ce solde ; un
        règlement n&apos;est jamais supprimé.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Règlement de la facture</legend>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Montant" htmlFor="amountXof" hint="XOF entier.">
            <input
              id="amountXof"
              name="amountXof"
              required
              inputMode="numeric"
              max={balanceXof}
              placeholder={String(balanceXof)}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Date" htmlFor="paidDate" hint="Aujourd'hui ou passée.">
            <input
              id="paidDate"
              name="paidDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Moyen" htmlFor="method">
            <select
              id="method"
              name="method"
              required
              defaultValue="transfer"
              className={INPUT_CLASS}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Référence" htmlFor="reference" hint="60 caractères maximum.">
            <input
              id="reference"
              name="reference"
              maxLength={60}
              placeholder="VIR-2026-0142"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le règlement"
            title="Enregistrer le règlement"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Banknote className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
