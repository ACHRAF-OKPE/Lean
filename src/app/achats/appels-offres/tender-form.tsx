"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createTenderAction, updateTenderAction } from "@/lib/tenders/actions";
import { EMPTY_TENDER_FORM_STATE } from "@/lib/tenders/form-state";
import type { ArticleOption } from "@/modules/purchases/queries";
import type { TenderSupplierOption } from "@/modules/tenders/queries";
import {
  MAX_TENDER_LINE_NOTE,
  MAX_TENDER_LINES,
  MAX_TENDER_SUPPLIERS,
} from "@/modules/tenders/rules";

interface LineDraft {
  readonly key: number;
  readonly articleId: string;
  readonly qty: string;
  readonly requestedDate: string;
  readonly note: string;
}

export interface TenderFormInitial {
  readonly title: string;
  readonly deadline: string;
  readonly notes: string;
  readonly lines: readonly {
    readonly articleId: string;
    readonly qty: string;
    readonly requestedDate: string | null;
    readonly note: string | null;
  }[];
  readonly supplierIds: readonly string[];
}

export function TenderForm({
  mode,
  tenderId,
  initial,
  suppliers,
  articles,
}: {
  mode: "create" | "edit";
  tenderId?: string;
  initial?: TenderFormInitial;
  suppliers: readonly TenderSupplierOption[];
  articles: readonly ArticleOption[];
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createTenderAction : updateTenderAction,
    EMPTY_TENDER_FORM_STATE,
  );
  const nextKey = useRef((initial?.lines.length ?? 0) + 1);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((line, index) => ({
          key: index + 1,
          articleId: line.articleId,
          qty: line.qty,
          requestedDate: line.requestedDate ?? "",
          note: line.note ?? "",
        }))
      : [{ key: 1, articleId: "", qty: "1", requestedDate: "", note: "" }],
  );
  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(
    () => new Set(initial?.supplierIds ?? []),
  );
  const articlesById = new Map(articles.map((article) => [article.id, article]));

  function updateLine(key: number, patch: Partial<Omit<LineDraft, "key">>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    if (lines.length >= MAX_TENDER_LINES) {
      return;
    }
    const key = nextKey.current;
    nextKey.current += 1;
    setLines((current) => [
      ...current,
      { key, articleId: "", qty: "1", requestedDate: "", note: "" },
    ]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key),
    );
  }

  function toggleSupplier(supplierId: string) {
    setSelectedSuppliers((current) => {
      const next = new Set(current);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else if (next.size < MAX_TENDER_SUPPLIERS) {
        next.add(supplierId);
      }
      return next;
    });
  }

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <FormErrors errors={state.errors} />
      {tenderId ? <input type="hidden" name="tenderId" value={tenderId} /> : null}

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">
          {mode === "create" ? "Nouvelle demande de cotation" : "Modifier la demande de cotation"}
        </legend>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">En-tête</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Intitulé" htmlFor="title" hint="1 à 120 caractères.">
              <input
                id="title"
                name="title"
                required
                maxLength={120}
                defaultValue={initial?.title ?? ""}
                placeholder="Pièces détachées ligne 2 — novembre"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              label="Date limite de cotation"
              htmlFor="deadline"
              hint="Aujourd'hui ou une date future. Le lien se ferme le soir de cette date."
            >
              <input
                id="deadline"
                name="deadline"
                type="date"
                required
                defaultValue={initial?.deadline ?? ""}
                className={INPUT_CLASS}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Note aux fournisseurs"
                htmlFor="notes"
                hint="2000 caractères maximum, facultative. Visible sur la page publique."
              >
                <textarea
                  id="notes"
                  name="notes"
                  maxLength={2000}
                  rows={3}
                  defaultValue={initial?.notes ?? ""}
                  placeholder="Conditions de livraison, lieu de réception, exigences qualité…"
                  className={`${INPUT_CLASS} min-h-24 resize-y`}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Besoins</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                {MAX_TENDER_LINES} lignes au maximum. Quantité à six décimales au plus.
              </p>
            </div>
            <button
              type="button"
              onClick={addLine}
              disabled={lines.length >= MAX_TENDER_LINES}
              aria-label="Ajouter une ligne de besoin"
              title="Ajouter une ligne"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {lines.map((line, index) => {
              const article = articlesById.get(line.articleId);
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
                        onChange={(event) =>
                          updateLine(line.key, { articleId: event.target.value })
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="" disabled>
                          Sélectionner un article
                        </option>
                        {articles.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.code} · {option.name}
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
                    <Field label="Date souhaitée" htmlFor={`date-${line.key}`} hint="Facultative.">
                      <input
                        id={`date-${line.key}`}
                        name="date_souhaitee"
                        type="date"
                        value={line.requestedDate}
                        onChange={(event) =>
                          updateLine(line.key, { requestedDate: event.target.value })
                        }
                        className={INPUT_CLASS}
                      />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field
                      label="Précision"
                      htmlFor={`note-${line.key}`}
                      hint={`${MAX_TENDER_LINE_NOTE} caractères maximum, facultative.`}
                    >
                      <input
                        id={`note-${line.key}`}
                        name="note_ligne"
                        maxLength={MAX_TENDER_LINE_NOTE}
                        value={line.note}
                        onChange={(event) => updateLine(line.key, { note: event.target.value })}
                        placeholder="Référence constructeur, qualité, conditionnement…"
                        className={INPUT_CLASS}
                      />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Fournisseurs invités</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                Chaque fournisseur reçoit un lien personnel par e-mail au moment de l&apos;envoi.
              </p>
            </div>
            <span className="font-mono text-[10px] text-muted">
              {selectedSuppliers.size} / {MAX_TENDER_SUPPLIERS}
            </span>
          </div>

          {suppliers.length === 0 ? (
            <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2.5 text-[11px] text-muted">
              Aucun fournisseur actif. Créez une fiche tiers avec le rôle fournisseur.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {suppliers.map((supplier) => {
                const disabled = !supplier.email;
                const checked = selectedSuppliers.has(supplier.id);
                return (
                  <li key={supplier.id}>
                    <label
                      className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                        disabled
                          ? "border-line bg-canvas opacity-60"
                          : checked
                            ? "border-brand/30 bg-brand-soft"
                            : "border-line bg-panel"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="supplierId"
                        value={supplier.id}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleSupplier(supplier.id)}
                        className="mt-0.5 size-3.5 accent-brand"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium">
                          {supplier.code} · {supplier.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted">
                          {supplier.email ?? "E-mail manquant : fiche tiers à compléter"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </fieldset>

      <div className="flex items-center justify-between">
        <Link
          href={tenderId ? `/achats/appels-offres/${tenderId}` : "/achats/appels-offres"}
          aria-label="Annuler et revenir aux appels d'offres"
          title="Annuler"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <button
          type="submit"
          disabled={pending}
          aria-label={
            mode === "create" ? "Enregistrer le brouillon" : "Enregistrer les modifications"
          }
          title={mode === "create" ? "Enregistrer le brouillon" : "Enregistrer"}
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
