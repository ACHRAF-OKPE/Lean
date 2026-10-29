"use client";

import { useActionState, useState } from "react";
import { CircleAlert, LoaderCircle, Send } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { submitTenderQuoteAction } from "@/lib/tenders/actions";
import { EMPTY_TENDER_FORM_STATE } from "@/lib/tenders/form-state";
import { formatXof } from "@/lib/money";
import { computeLineTotal } from "@/modules/stock/quantities";

interface QuoteLine {
  readonly lineNumber: number;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
}

export interface QuoteLineInitial {
  readonly qty: string;
  readonly price: string;
}

export function TenderQuoteForm({
  token,
  lines,
  defaultAuthorName,
  defaultEmail,
  maxLeadTimeDays,
  maxComment,
  initial,
  initialLeadTimeDays,
  initialComment,
  initialDeclined,
}: {
  token: string;
  lines: readonly QuoteLine[];
  defaultAuthorName: string;
  defaultEmail: string;
  maxLeadTimeDays: number;
  maxComment: number;
  initial: Readonly<Record<number, QuoteLineInitial>>;
  initialLeadTimeDays: string;
  initialComment: string;
  initialDeclined: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    submitTenderQuoteAction,
    EMPTY_TENDER_FORM_STATE,
  );
  const [declined, setDeclined] = useState(initialDeclined);
  const [values, setValues] = useState<Record<number, QuoteLineInitial>>(() => {
    const entries: Record<number, QuoteLineInitial> = {};
    for (const line of lines) {
      entries[line.lineNumber] = initial[line.lineNumber] ?? { qty: "0", price: "" };
    }
    return entries;
  });

  function update(lineNumber: number, patch: Partial<QuoteLineInitial>) {
    setValues((current) => ({
      ...current,
      [lineNumber]: { ...(current[lineNumber] ?? { qty: "0", price: "" }), ...patch },
    }));
  }

  function lineTotal(lineNumber: number): number | null {
    const value = values[lineNumber];
    if (!value) {
      return null;
    }
    const qty = value.qty.trim().replace(",", ".");
    const price = value.price.trim();
    if (qty === "" || qty === "0") {
      return 0;
    }
    if (!/^\d+(?:\.\d{1,6})?$/.test(qty) || !/^\d+$/.test(price)) {
      return null;
    }
    const unitPrice = Number(price);
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
      return null;
    }
    try {
      return computeLineTotal(qty, unitPrice);
    } catch {
      return null;
    }
  }

  const total = lines.reduce((sum, line) => sum + (lineTotal(line.lineNumber) ?? 0), 0);

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="token" value={token} />
      <div className="absolute left-[-9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="company_website">Site de l&apos;entreprise</label>
        <input
          id="company_website"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <fieldset disabled={pending} className="space-y-5">
        <legend className="sr-only">Déposer une cotation</legend>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Votre contact</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Nom du signataire" htmlFor="authorName" hint="1 à 120 caractères.">
              <input
                id="authorName"
                name="authorName"
                required
                maxLength={120}
                defaultValue={defaultAuthorName}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="E-mail de contact"
              htmlFor="authorEmail"
              hint="Facultatif, pour confirmer votre cotation."
            >
              <input
                id="authorEmail"
                name="authorEmail"
                type="email"
                maxLength={160}
                defaultValue={defaultEmail}
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Délai de livraison (jours)"
              htmlFor="leadTimeDays"
              hint={`Entier entre 0 et ${maxLeadTimeDays}, facultatif.`}
            >
              <input
                id="leadTimeDays"
                name="leadTimeDays"
                inputMode="numeric"
                maxLength={3}
                defaultValue={initialLeadTimeDays}
                placeholder="15"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
            <Field
              label="Offre globale"
              htmlFor="declined"
              hint="Cochez si vous ne pouvez pas répondre à cette demande."
            >
              <label className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
                <input
                  id="declined"
                  name="declined"
                  type="checkbox"
                  checked={declined}
                  onChange={(event) => setDeclined(event.target.checked)}
                  className="size-3.5 accent-brand"
                />
                <span className="text-[11px]">Nous ne pouvons pas coter cette demande</span>
              </label>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Vos propositions</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                Indiquez 0 en quantité pour une ligne non proposée. Le prix est alors inutile.
              </p>
            </div>
            <span className="font-mono text-sm tabular-nums">{formatXof(total)}</span>
          </div>

          <div className="mt-4 space-y-3">
            {lines.map((line) => {
              const value = values[line.lineNumber] ?? { qty: "0", price: "" };
              const totalLine = lineTotal(line.lineNumber);
              return (
                <div
                  key={line.lineNumber}
                  className="rounded-lg border border-line bg-canvas p-3.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px]">
                      <span className="font-mono text-[10px] text-muted">
                        {String(line.lineNumber).padStart(2, "0")} ·{" "}
                      </span>
                      <span className="font-medium">{line.name}</span>
                    </p>
                    <p className="font-mono text-[10px] text-muted tabular-nums">
                      demandé : {line.qty} {line.unitCode}
                    </p>
                  </div>
                  <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      label="Quantité proposée"
                      htmlFor={`qty-${line.lineNumber}`}
                      hint={`0 à ${line.qty} ${line.unitCode}.`}
                    >
                      <input
                        id={`qty-${line.lineNumber}`}
                        name={`qty-${line.lineNumber}`}
                        inputMode="decimal"
                        value={value.qty}
                        disabled={declined}
                        onChange={(event) => update(line.lineNumber, { qty: event.target.value })}
                        className={`${INPUT_CLASS} tabular-nums`}
                      />
                    </Field>
                    <Field
                      label="Prix unitaire (XOF)"
                      htmlFor={`price-${line.lineNumber}`}
                      hint="Obligatoire si la quantité est positive."
                    >
                      <input
                        id={`price-${line.lineNumber}`}
                        name={`price-${line.lineNumber}`}
                        inputMode="numeric"
                        value={value.price}
                        disabled={declined}
                        onChange={(event) => update(line.lineNumber, { price: event.target.value })}
                        placeholder="180000"
                        className={`${INPUT_CLASS} tabular-nums`}
                      />
                    </Field>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-muted tabular-nums">
                    Total ligne{" "}
                    <span className="font-medium text-ink">
                      {totalLine === null ? "—" : formatXof(totalLine)}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <Field
            label={declined ? "Motif du refus" : "Commentaire"}
            htmlFor="comment"
            hint={
              declined
                ? `Obligatoire, ${maxComment} caractères maximum.`
                : `Conditions, alternatives, ${maxComment} caractères maximum.`
            }
          >
            <textarea
              id="comment"
              name="comment"
              maxLength={maxComment}
              rows={3}
              defaultValue={initialComment}
              placeholder={
                declined
                  ? "Produit indisponible sur la période, rupture fournisseur…"
                  : "Délais fermes, conditions de paiement, variantes possibles…"
              }
              className={`${INPUT_CLASS} min-h-24 resize-y`}
            />
          </Field>
          {declined ? (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-copper">
              <CircleAlert className="size-3" aria-hidden="true" />
              Les quantités et prix sont ignorés : seul votre refus motivé sera transmis.
            </p>
          ) : null}
        </section>
      </fieldset>

      <div className="flex items-center justify-between">
        <p className="max-w-sm text-[10px] leading-4 text-muted">
          Chaque dépôt crée une nouvelle révision horodatée. La dernière reçue avant la date limite
          fait foi.
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-label="Déposer la cotation"
          title="Déposer la cotation"
          className="grid size-10 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
