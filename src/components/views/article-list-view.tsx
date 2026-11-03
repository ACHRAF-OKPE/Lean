"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  Download,
  LoaderCircle,
  Pencil,
  Tags,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { bulkArticleAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import { formatXof } from "@/lib/money";
import { isArticleBulkActionAllowed, type ArticleBulkAction } from "@/modules/catalog/article-bulk";
import type { ArticleCategory } from "@/modules/catalog/article-queries";
import { ARTICLE_TYPE_LABELS, unitLabel } from "@/modules/catalog/constants";
import { articlesExportHref, type ArticleFilters } from "@/modules/catalog/article-filters";
import type { ArticleSummary } from "@/modules/catalog/queries";
import type { RequiredLevel } from "@/modules/identity/modules";

const COMMAND =
  "grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const TH = "px-3 py-2.5 font-normal";
const TD = "px-3 py-2.5";

function Command({
  action,
  label,
  icon: Icon,
  pending,
  disabled,
}: {
  action: ArticleBulkAction;
  label: string;
  icon: LucideIcon;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="submit"
      name="action"
      value={action}
      disabled={pending || disabled}
      aria-label={label}
      title={label}
      className={COMMAND}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

/** GEN-017 — la sélection se fait ligne à ligne ou en bloc, et chaque commande n'apparaît qu'au niveau qui la permet. */
export function ArticleListView({
  filters,
  rows,
  categoryTitles,
  categories,
  level,
  retour,
}: {
  filters: ArticleFilters;
  rows: readonly ArticleSummary[];
  categoryTitles: Readonly<Record<string, readonly { id: string; title: string }[]>>;
  categories: readonly ArticleCategory[];
  level: RequiredLevel;
  retour: string;
}) {
  const [state, formAction, pending] = useActionState(bulkArticleAction, EMPTY_CATALOG_FORM_STATE);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const allowed = (action: ArticleBulkAction) => isArticleBulkActionAllowed(action, level);

  return (
    <form
      action={formAction}
      aria-label="Sélection et actions sur les articles"
      className="overflow-hidden rounded-xl border border-line bg-panel"
    >
      <input type="hidden" name="retour" value={retour} />

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="text-[11px] text-muted" role="status">
          {selected.length === 0
            ? "Aucune ligne sélectionnée."
            : `${selected.length} ligne${selected.length > 1 ? "s" : ""} sélectionnée${selected.length > 1 ? "s" : ""}.`}
        </p>

        <span className="grow" />

        {allowed("categories") ? (
          <div className="flex items-center gap-1.5">
            <select
              name="categorie"
              defaultValue=""
              aria-label="Catégorie à affecter à la sélection"
              className={`${INPUT_CLASS} w-44`}
            >
              <option value="">Aucune catégorie</option>
              {categories
                .filter((category) => category.active)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
            </select>
            <Command
              action="categories"
              label="Remplacer les catégories de la sélection"
              icon={Tags}
              pending={pending}
              disabled={selected.length === 0}
            />
          </div>
        ) : null}

        {allowed("activer") ? (
          <Command
            action="activer"
            label="Réactiver la sélection"
            icon={CheckCircle2}
            pending={pending}
            disabled={selected.length === 0}
          />
        ) : null}

        {allowed("desactiver") ? (
          <Command
            action="desactiver"
            label="Désactiver la sélection"
            icon={Ban}
            pending={pending}
            disabled={selected.length === 0}
          />
        ) : null}

        {allowed("categories") && selected.length === 1 ? (
          <Link
            href={`/articles/${selected[0]}/modifier`}
            aria-label="Modifier l'article sélectionné"
            title="Modifier l'article sélectionné"
            className={COMMAND}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        ) : null}

        <a
          href={articlesExportHref(filters, selected)}
          aria-label={
            selected.length === 0
              ? "Exporter le jeu filtré en XLSX"
              : "Exporter la sélection en XLSX"
          }
          title={selected.length === 0 ? "Exporter le jeu filtré" : "Exporter la sélection"}
          className={COMMAND}
        >
          <Download className="size-4" aria-hidden="true" />
        </a>

        {allowed("supprimer") ? (
          <Command
            action="supprimer"
            label="Supprimer la sélection"
            icon={Trash2}
            pending={pending}
            disabled={selected.length === 0}
          />
        ) : null}
      </div>

      {state.errors.length > 0 ? (
        <div className="border-b border-line px-4 py-3">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <caption className="sr-only">Articles du jeu filtré</caption>
          <thead>
            <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
              <th scope="col" className={TH}>
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(event.target.checked ? rows.map((row) => row.id) : [])
                  }
                  className="size-3.5 accent-brand"
                />
              </th>
              <th scope="col" className={TH}>
                Code
              </th>
              <th scope="col" className={TH}>
                Désignation
              </th>
              <th scope="col" className={TH}>
                Type
              </th>
              <th scope="col" className={TH}>
                Unité
              </th>
              <th scope="col" className={TH}>
                Code SH
              </th>
              <th scope="col" className={TH}>
                Vente
              </th>
              <th scope="col" className={TH}>
                Achat
              </th>
              <th scope="col" className={TH}>
                Catégories
              </th>
              <th scope="col" className={TH}>
                Statut
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const titles = categoryTitles[row.id] ?? [];
              return (
                <tr key={row.id} className="border-b border-line last:border-b-0">
                  <td className={TD}>
                    <input
                      type="checkbox"
                      name="id"
                      value={row.id}
                      aria-label={`Sélectionner ${row.name}`}
                      checked={selected.includes(row.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, row.id]
                            : current.filter((id) => id !== row.id),
                        )
                      }
                      className="size-3.5 accent-brand"
                    />
                  </td>
                  <td className={`${TD} font-mono text-[10px] whitespace-nowrap`}>{row.code}</td>
                  <td className={`${TD} font-medium`}>
                    <Link
                      href={`/articles/${row.id}`}
                      className="transition-colors hover:text-brand"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-muted`}>
                    {ARTICLE_TYPE_LABELS[row.type]}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-muted`}>
                    {unitLabel(row.unitCode)}
                  </td>
                  <td className={`${TD} font-mono text-[10px] whitespace-nowrap`}>
                    {row.hsCode ?? "—"}
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
                    {formatXof(row.salePriceXof)}
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
                    {formatXof(row.purchasePriceXof)}
                  </td>
                  <td className={TD}>
                    {titles.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {titles.map((category) => (
                          <span
                            key={category.id}
                            className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-muted"
                          >
                            {category.title}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        row.active
                          ? "border-line bg-canvas text-muted"
                          : "border-copper/15 bg-copper-soft text-copper"
                      }`}
                    >
                      {row.active ? "Actif" : "Inactif"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
