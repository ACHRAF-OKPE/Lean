import Link from "next/link";
import { Search, X } from "lucide-react";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import {
  hasActiveHsCodeFilters,
  hsCodesHref,
  type HsCodeFilters,
} from "@/modules/catalog/hs-code-filters";

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

/**
 * ART-019 — les filtres se posent dans l'adresse : le formulaire est un GET, chaque critère reprend
 * le nom que `parseHsCodeFilters` sait relire, et la vue choisie survit à l'application des filtres.
 */
export function HsCodeFilterBar({ filters }: { filters: HsCodeFilters }) {
  return (
    <form
      method="get"
      action="/nomenclature"
      aria-label="Filtres de la nomenclature"
      className="rounded-xl border border-line bg-panel p-4"
    >
      {filters.view === "liste" ? null : <input type="hidden" name="vue" value={filters.view} />}

      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Recherche" htmlFor="filtre-q" hint="Code ou libellé, insensible à la casse.">
          <input
            id="filtre-q"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={filters.search}
            placeholder="090111, café…"
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Niveau"
          htmlFor="filtre-niveau"
          hint="Longueur du code : position, sous-position, ligne."
        >
          <select
            id="filtre-niveau"
            name="niveau"
            defaultValue={filters.level === null ? "" : String(filters.level)}
            className={INPUT_CLASS}
          >
            <option value="">Tous les niveaux</option>
            <option value="6">Position (6 chiffres)</option>
            <option value="8">Sous-position (8 chiffres)</option>
            <option value="10">Ligne (10 chiffres)</option>
          </select>
        </Field>

        <Field
          label="Taux TEC"
          htmlFor="filtre-tec"
          hint="Un code sans taux bloque la liquidation."
        >
          <select
            id="filtre-tec"
            name="tec"
            defaultValue={filters.tec ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Avec ou sans taux</option>
            <option value="present">Taux présent</option>
            <option value="absent">Taux absent</option>
          </select>
        </Field>

        <Field
          label="Usage"
          htmlFor="filtre-usage"
          hint="Cité par un article ou une ligne de déclaration."
        >
          <select
            id="filtre-usage"
            name="usage"
            defaultValue={filters.usage ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Tous les codes</option>
            <option value="utilise">Utilisés par un document</option>
            <option value="libre">Sans usage</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[10px] leading-4 text-muted">
          Les filtres se combinent et restent lisibles dans l&apos;adresse, à partager telles
          quelles.
        </p>
        <div className="flex items-center gap-1.5">
          {hasActiveHsCodeFilters(filters) ? (
            <Link
              href={hsCodesHref(filters, { search: "", level: null, tec: null, usage: null })}
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
