"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createSalesOrderAction } from "@/lib/sales/actions";
import { EMPTY_SALES_FORM_STATE } from "@/lib/sales/form-state";
import { formatXof } from "@/lib/money";
import { INCOTERMS } from "@/modules/sales/validation";
import type { CustomerOption, SalesArticleOption } from "@/modules/sales/queries";
import { computeLineTotal } from "@/modules/stock/quantities";

interface LineDraft {
  readonly key: number;
  readonly articleId: string;
  readonly qty: string;
  readonly price: string;
}

function lineTotal(line: LineDraft): number | null {
  const qty = line.qty.trim().replace(",", ".");
  const price = line.price.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(qty) || !/^\d+$/.test(price)) {
    return null;
  }
  const unitPrice = Number(price);
  if (!Number.isSafeInteger(unitPrice)) {
    return null;
  }
  try {
    const total = computeLineTotal(qty, unitPrice);
    return Number.isSafeInteger(total) ? total : null;
  } catch {
    return null;
  }
}

export function SalesOrderForm({
  customers,
  articles,
}: {
  customers: readonly CustomerOption[];
  articles: readonly SalesArticleOption[];
}) {
  const [state, formAction, pending] = useActionState(
    createSalesOrderAction,
    EMPTY_SALES_FORM_STATE,
  );
  const nextKey = useRef(2);
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, articleId: "", qty: "1", price: "" }]);
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const total = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);

  function updateLine(key: number, patch: Partial<Omit<LineDraft, "key">>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectArticle(key: number, articleId: string) {
    const article = articlesById.get(articleId);
    updateLine(key, {
      articleId,
      price: article ? String(article.salePriceXof) : "",
    });
  }

  function addLine() {
    const key = nextKey.current;
    nextKey.current += 1;
    setLines((current) => [...current, { key, articleId: "", qty: "1", price: "" }]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Nouvelle commande client</legend>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">En-tête</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Client" htmlFor="customerId" hint="Tiers actif avec le rôle client.">
              <select
                id="customerId"
                name="customerId"
                required
                defaultValue=""
                className={INPUT_CLASS}
              >
                <option value="" disabled>
                  Sélectionner un client
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.code} · {customer.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Livraison prévue"
              htmlFor="expectedDeliveryDate"
              hint="Facultative, au format AAAA-MM-JJ."
            >
              <input
                id="expectedDeliveryDate"
                name="expectedDeliveryDate"
                type="date"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Référence client"
              htmlFor="externalReference"
              hint="60 caractères maximum, facultative."
            >
              <input
                id="externalReference"
                name="externalReference"
                maxLength={60}
                placeholder="PO-CL-2026-021"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Incoterm" htmlFor="incoterm" hint="Facultatif, norme ICC 2020.">
              <select id="incoterm" name="incoterm" defaultValue="" className={INPUT_CLASS}>
                <option value="">Non précisé</option>
                {INCOTERMS.map((incoterm) => (
                  <option key={incoterm} value={incoterm}>
                    {incoterm}
                  </option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes" htmlFor="notes" hint="1000 caractères maximum, facultatives.">
                <textarea
                  id="notes"
                  name="notes"
                  maxLength={1000}
                  rows={2}
                  placeholder="Conditions particulières"
                  className={`${INPUT_CLASS} min-h-18 resize-y`}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Lignes</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                Quantité à six décimales au plus, prix unitaire XOF entier.
              </p>
            </div>
            <button
              type="button"
              onClick={addLine}
              aria-label="Ajouter une ligne"
              title="Ajouter une ligne"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {lines.map((line, index) => {
              const article = articlesById.get(line.articleId);
              const totalLine = lineTotal(line);
              return (
                <div key={line.key} className="rounded-lg border border-line bg-canvas p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] text-muted">
                      Ligne {String(index + 1).padStart(2, "0")}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                      aria-label={`Supprimer la ligne ${index + 1}`}
                      title="Supprimer la ligne"
                      className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/30 hover:text-copper disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]">
                    <Field label="Article" htmlFor={`article-${line.key}`}>
                      <select
                        id={`article-${line.key}`}
                        name="articleId"
                        required
                        value={line.articleId}
                        onChange={(event) => selectArticle(line.key, event.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="" disabled>
                          Sélectionner un article
                        </option>
                        {articles.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.code} · {option.name}
                            {option.type === "service" ? " (service)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Quantité"
                      htmlFor={`quantite-${line.key}`}
                      hint={article ? `Unité : ${article.unitCode}` : undefined}
                    >
                      <input
                        id={`quantite-${line.key}`}
                        name="quantite"
                        required
                        inputMode="decimal"
                        value={line.qty}
                        onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                        placeholder="12,5"
                        className={`${INPUT_CLASS} tabular-nums`}
                      />
                    </Field>
                    <Field label="Prix unitaire" htmlFor={`prix-${line.key}`} hint="XOF entier">
                      <input
                        id={`prix-${line.key}`}
                        name="prix_unitaire_xof"
                        required
                        inputMode="numeric"
                        value={line.price}
                        onChange={(event) => updateLine(line.key, { price: event.target.value })}
                        placeholder="250000"
                        className={`${INPUT_CLASS} tabular-nums`}
                      />
                    </Field>
                  </div>

                  <p className="mt-2 text-right text-[10px] text-muted tabular-nums">
                    Total ligne{" "}
                    <span className="font-medium text-ink">
                      {totalLine === null ? "—" : formatXof(totalLine)}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <p className="text-[11px] text-muted">Total commande</p>
            <p className="font-mono text-sm font-medium tabular-nums">
              {Number.isSafeInteger(total) ? formatXof(total) : "—"}
            </p>
          </div>
        </section>
      </fieldset>

      <div className="flex items-center justify-between">
        <Link
          href="/ventes"
          aria-label="Annuler et revenir aux ventes"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer la commande en brouillon"
          title="Enregistrer en brouillon"
          className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
