import { PARTNER_ROLES, type PartnerRole } from "./constants";

/** GEN-016 — les vues proposées sur une liste de référence. */
export const PARTNER_VIEWS = ["liste", "kanban", "carte"] as const;
export type PartnerView = (typeof PARTNER_VIEWS)[number];

export type PartnerState = "actif" | "inactif";

/** ART-010 — ce que la liste sait filtrer. */
export interface PartnerListFilters {
  readonly search: string;
  readonly roles: readonly PartnerRole[];
  readonly state: PartnerState | null;
  readonly categoryIds: readonly string[];
  readonly countryCode: string | null;
  /** GEN-017 — une sélection d'identifiants borne le jeu lu, pour l'export notamment. */
  readonly ids: readonly string[];
}

/** GEN-016 — la vue choisie s'ajoute aux filtres ; elle ne change pas le jeu lu. */
export interface PartnerFilters extends PartnerListFilters {
  readonly view: PartnerView;
}

export const EMPTY_PARTNER_LIST_FILTERS: PartnerListFilters = {
  search: "",
  roles: [],
  state: null,
  categoryIds: [],
  countryCode: null,
  ids: [],
};

export const EMPTY_PARTNER_FILTERS: PartnerFilters = {
  ...EMPTY_PARTNER_LIST_FILTERS,
  view: "liste",
};

type RawParams = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined, max: number): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, max);
}

function list(value: string | string[] | undefined): readonly string[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_SELECTED_IDS = 200;

function uuids(value: string | string[] | undefined, cap: number): readonly string[] {
  return [...new Set(list(value).filter((id) => UUID_PATTERN.test(id)))].slice(0, cap);
}

/** ART-010 + GEN-016 — rien ne sort de l'URL : ce qui n'est pas une valeur connue est abandonné. */
export function parsePartnerFilters(raw: RawParams): PartnerFilters {
  const roles = list(raw.role).filter((role): role is PartnerRole =>
    (PARTNER_ROLES as readonly string[]).includes(role),
  );
  const state = text(raw.etat, 10).toLowerCase();
  // ART-010 — le pays se juge sur ce qui a été saisi : « CIV » reste refusé, jamais tronqué en « CI ».
  const country = text(raw.pays, 10).toUpperCase();

  return {
    search: text(raw.q, 80),
    roles: [...new Set(roles)],
    state: state === "actif" || state === "inactif" ? state : null,
    categoryIds: uuids(raw.categorie, 20),
    countryCode: /^[A-Z]{2}$/.test(country) ? country : null,
    ids: uuids(raw.id, MAX_SELECTED_IDS),
    view: (PARTNER_VIEWS as readonly string[]).includes(text(raw.vue, 10))
      ? (text(raw.vue, 10) as PartnerView)
      : "liste",
  };
}

/** GEN-016 — le jeu filtré se lit dans l'adresse ; la vue et l'export partagent la même requête. */
export function partnerFiltersQuery(filters: PartnerFilters): string {
  const params = new URLSearchParams();

  if (filters.search !== "") params.set("q", filters.search);
  for (const role of filters.roles) params.append("role", role);
  if (filters.state) params.set("etat", filters.state);
  for (const id of filters.categoryIds) params.append("categorie", id);
  if (filters.countryCode) params.set("pays", filters.countryCode);
  if (filters.view !== "liste") params.set("vue", filters.view);

  return params.toString();
}

/** ART-010 — les filtres se lisent dans l'adresse et se partagent tels quels. */
export function partnersHref(
  filters: PartnerFilters,
  overrides: Partial<PartnerFilters> = {},
): string {
  const query = partnerFiltersQuery({ ...filters, ...overrides });
  return query === "" ? "/tiers" : `/tiers?${query}`;
}

/** GEN-017 — l'export d'une sélection reprend le jeu filtré et y ajoute les identifiants retenus. */
export function partnersExportHref(filters: PartnerFilters, ids: readonly string[] = []): string {
  const params = new URLSearchParams(partnerFiltersQuery(filters));
  for (const id of ids) params.append("id", id);
  const query = params.toString();
  return query === "" ? "/api/export/tiers" : `/api/export/tiers?${query}`;
}

/** Le bouton « effacer » n'a de sens que si au moins un filtre ou une vue est sorti du repos. */
export function hasActivePartnerFilters(filters: PartnerFilters): boolean {
  return (
    filters.search !== "" ||
    filters.roles.length > 0 ||
    filters.state !== null ||
    filters.categoryIds.length > 0 ||
    filters.countryCode !== null ||
    filters.view !== "liste"
  );
}
