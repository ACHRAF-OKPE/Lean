import type { ArticleType } from "@/db/schema";

/** ART-013 — les vues proposées sur le registre des articles. */
export const ARTICLE_VIEWS = ["liste", "kanban", "grille"] as const;
export type ArticleView = (typeof ARTICLE_VIEWS)[number];

export type ArticleState = "actif" | "inactif";

const ARTICLE_TYPES: readonly ArticleType[] = ["product", "service"];

/** ART-013 — ce que la liste des articles sait filtrer. */
export interface ArticleListFilters {
  readonly search: string;
  readonly types: readonly ArticleType[];
  readonly state: ArticleState | null;
  readonly categoryIds: readonly string[];
  /** GEN-017 — une sélection d'identifiants borne le jeu lu, pour l'export notamment. */
  readonly ids: readonly string[];
}

/** ART-013 — la vue choisie s'ajoute aux filtres ; elle ne change pas le jeu lu. */
export interface ArticleFilters extends ArticleListFilters {
  readonly view: ArticleView;
}

export const EMPTY_ARTICLE_LIST_FILTERS: ArticleListFilters = {
  search: "",
  types: [],
  state: null,
  categoryIds: [],
  ids: [],
};

export const EMPTY_ARTICLE_FILTERS: ArticleFilters = {
  ...EMPTY_ARTICLE_LIST_FILTERS,
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

/** ART-013 — rien ne sort de l'URL : ce qui n'est pas une valeur connue est abandonné. */
export function parseArticleFilters(raw: RawParams): ArticleFilters {
  const types = list(raw.type).filter((type): type is ArticleType =>
    (ARTICLE_TYPES as readonly string[]).includes(type),
  );
  const state = text(raw.etat, 10).toLowerCase();

  return {
    search: text(raw.q, 80),
    types: [...new Set(types)],
    state: state === "actif" || state === "inactif" ? state : null,
    categoryIds: uuids(raw.categorie, 20),
    ids: uuids(raw.id, MAX_SELECTED_IDS),
    view: (ARTICLE_VIEWS as readonly string[]).includes(text(raw.vue, 10))
      ? (text(raw.vue, 10) as ArticleView)
      : "liste",
  };
}

/** ART-013 — le jeu filtré se lit dans l'adresse ; la vue et l'export partagent la même requête. */
export function articleFiltersQuery(filters: ArticleFilters): string {
  const params = new URLSearchParams();

  if (filters.search !== "") params.set("q", filters.search);
  for (const type of filters.types) params.append("type", type);
  if (filters.state) params.set("etat", filters.state);
  for (const id of filters.categoryIds) params.append("categorie", id);
  if (filters.view !== "liste") params.set("vue", filters.view);

  return params.toString();
}

/** ART-013 — les filtres se lisent dans l'adresse et se partagent tels quels. */
export function articlesHref(
  filters: ArticleFilters,
  overrides: Partial<ArticleFilters> = {},
): string {
  const query = articleFiltersQuery({ ...filters, ...overrides });
  return query === "" ? "/articles" : `/articles?${query}`;
}

/** GEN-017 — l'export d'une sélection reprend le jeu filtré et y ajoute les identifiants retenus. */
export function articlesExportHref(filters: ArticleFilters, ids: readonly string[] = []): string {
  const params = new URLSearchParams(articleFiltersQuery(filters));
  for (const id of ids) params.append("id", id);
  const query = params.toString();
  return query === "" ? "/api/export/articles" : `/api/export/articles?${query}`;
}

/** Le bouton « effacer » n'a de sens que si au moins un filtre ou une vue est sorti du repos. */
export function hasActiveArticleFilters(filters: ArticleFilters): boolean {
  return (
    filters.search !== "" ||
    filters.types.length > 0 ||
    filters.state !== null ||
    filters.categoryIds.length > 0 ||
    filters.view !== "liste"
  );
}
