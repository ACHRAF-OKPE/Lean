import Link from "next/link";
import { Search, X } from "lucide-react";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { PARTNER_ROLE_LABELS, PARTNER_ROLES } from "@/modules/catalog/constants";
import {
  hasActivePartnerFilters,
  partnersHref,
  type PartnerFilters,
} from "@/modules/catalog/filters";
import type { PartnerCategory } from "@/modules/catalog/partner-queries";

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const CHECKBOX = "size-3.5 accent-brand";

/**
 * ART-010 — les filtres se posent dans l'adresse : le formulaire est un GET, chaque critère reprend le
 * nom que `parsePartnerFilters` sait relire, et la vue choisie survit à l'application des filtres.
 */
export function PartnerFilterBar({
  filters,
  categories,
}: {
  filters: PartnerFilters;
  categories: readonly PartnerCategory[];
}) {
  const selectable = categories.filter(
    (category) => category.active || filters.categoryIds.includes(category.id),
  );

  return (
    <form
      method="get"
      action="/tiers"
      aria-label="Filtres du registre des tiers"
      className="rounded-xl border border-line bg-panel p-4"
    >
      {filters.view === "liste" ? null : <input type="hidden" name="vue" value={filters.view} />}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Recherche" htmlFor="filtre-q" hint="Référence ou nom, insensible à la casse.">
          <input
            id="filtre-q"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={filters.search}
            placeholder="CLI001, Sahel…"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Pays" htmlFor="filtre-pays" hint="Code ISO 3166-1 à deux lettres.">
          <input
            id="filtre-pays"
            name="pays"
            maxLength={2}
            pattern="[A-Za-z]{2}"
            defaultValue={filters.countryCode ?? ""}
            placeholder="CI"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>

        <Field label="État" htmlFor="filtre-etat" hint="Un tiers inactif reste listé.">
          <select
            id="filtre-etat"
            name="etat"
            defaultValue={filters.state ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Tous les états</option>
            <option value="actif">Actifs</option>
            <option value="inactif">Inactifs</option>
          </select>
        </Field>

        <fieldset className="space-y-1.5">
          <legend className="block text-[11px] font-medium">Rôles</legend>
          <div className="flex items-center gap-4 border-b border-line px-1 py-2">
            {PARTNER_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  name="role"
                  value={role}
                  defaultChecked={filters.roles.includes(role)}
                  className={CHECKBOX}
                />
                {PARTNER_ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {selectable.length > 0 ? (
        <fieldset className="mt-4 space-y-1.5">
          <legend className="block text-[11px] font-medium">Catégories</legend>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-1 py-2">
            {selectable.map((category) => (
              <label key={category.id} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  name="categorie"
                  value={category.id}
                  defaultChecked={filters.categoryIds.includes(category.id)}
                  className={CHECKBOX}
                />
                {category.title}
                {category.active ? null : (
                  <span className="text-[10px] text-copper">désactivée</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[10px] leading-4 text-muted">
          Les filtres se combinent et restent lisibles dans l&apos;adresse, à partager telles
          quelles.
        </p>
        <div className="flex items-center gap-1.5">
          {hasActivePartnerFilters(filters) ? (
            <Link
              href={partnersHref(filters, {
                search: "",
                roles: [],
                state: null,
                categoryIds: [],
                countryCode: null,
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
