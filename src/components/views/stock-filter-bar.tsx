import Link from "next/link";
import { Search, X } from "lucide-react";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { hasActiveStockFilters, stockHref, type StockFilters } from "@/modules/stock/filters";
import { STOCK_MOVE_TYPE_LABELS, STOCK_MOVE_TYPE_OPTIONS } from "@/modules/stock/labels";

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

/**
 * STK-009 — les filtres se posent dans l'adresse : le formulaire est un GET, chaque critère reprend
 * le nom que `parseStockFilters` sait relire, et la vue choisie survit à l'application des filtres.
 */
export function StockFilterBar({
  filters,
  locations,
}: {
  filters: StockFilters;
  locations: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}) {
  return (
    <form
      method="get"
      action="/stock/registre"
      aria-label="Filtres du registre des mouvements"
      className="rounded-xl border border-line bg-panel p-4"
    >
      {filters.view === "liste" ? null : <input type="hidden" name="vue" value={filters.view} />}

      <div className="grid gap-4 md:grid-cols-5">
        <Field
          label="Recherche"
          htmlFor="filtre-q"
          hint="Numéro de mouvement, code ou libellé d'article."
        >
          <input
            id="filtre-q"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={filters.search}
            placeholder="MVT-2026, ART001, café…"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Magasin" htmlFor="filtre-magasin" hint="Origine ou destination.">
          <select
            id="filtre-magasin"
            name="magasin"
            defaultValue={filters.locationId ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Tous les magasins</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type" htmlFor="filtre-type" hint="Entrée, sortie ou transfert.">
          <select
            id="filtre-type"
            name="type"
            defaultValue={filters.type ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Tous les types</option>
            {STOCK_MOVE_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {STOCK_MOVE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Du" htmlFor="filtre-du" hint="Date de mouvement incluse.">
          <input
            id="filtre-du"
            name="du"
            type="date"
            defaultValue={filters.from ?? ""}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Au" htmlFor="filtre-au" hint="Date de mouvement incluse.">
          <input
            id="filtre-au"
            name="au"
            type="date"
            defaultValue={filters.to ?? ""}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[10px] leading-4 text-muted">
          Les filtres se combinent et restent lisibles dans l&apos;adresse, à partager telles
          quelles.
        </p>
        <div className="flex items-center gap-1.5">
          {hasActiveStockFilters(filters) ? (
            <Link
              href={stockHref(filters, {
                search: "",
                locationId: null,
                type: null,
                from: null,
                to: null,
              })}
              aria-label="Effacer les filtres"
              title="Effacer les filtres"
              className={ACTION_LINK}
            >
              <X className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          <button
            type="submit"
            aria-label="Appliquer les filtres"
            title="Appliquer les filtres"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}
