/** ART-019 — les vues proposées sur le registre de la nomenclature. */
export const HS_CODE_VIEWS = ["liste", "arbre"] as const;
export type HsCodeView = (typeof HS_CODE_VIEWS)[number];

export type HsLevelFilter = 6 | 8 | 10;
export type HsTecFilter = "present" | "absent";
export type HsUsageFilter = "utilise" | "libre";

const HS_LEVELS: readonly HsLevelFilter[] = [6, 8, 10];
const TEC_FILTERS: readonly HsTecFilter[] = ["present", "absent"];
const USAGE_FILTERS: readonly HsUsageFilter[] = ["utilise", "libre"];

/** ART-019 — ce que la liste de la nomenclature sait filtrer. */
export interface HsCodeFilters {
  readonly search: string;
  readonly level: HsLevelFilter | null;
  readonly tec: HsTecFilter | null;
  readonly usage: HsUsageFilter | null;
  readonly view: HsCodeView;
}

export const EMPTY_HS_CODE_FILTERS: HsCodeFilters = {
  search: "",
  level: null,
  tec: null,
  usage: null,
  view: "liste",
};

type RawParams = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined, max: number): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, max);
}

/** ART-019 — rien ne sort de l'URL : ce qui n'est pas une valeur connue est abandonné. */
export function parseHsCodeFilters(raw: RawParams): HsCodeFilters {
  const level = Number(text(raw.niveau, 2));
  const tec = text(raw.tec, 10).toLowerCase();
  const usage = text(raw.usage, 10).toLowerCase();
  const view = text(raw.vue, 10).toLowerCase();

  return {
    search: text(raw.q, 80),
    level: (HS_LEVELS as readonly number[]).includes(level) ? (level as HsLevelFilter) : null,
    tec: (TEC_FILTERS as readonly string[]).includes(tec) ? (tec as HsTecFilter) : null,
    usage: (USAGE_FILTERS as readonly string[]).includes(usage) ? (usage as HsUsageFilter) : null,
    view: (HS_CODE_VIEWS as readonly string[]).includes(view) ? (view as HsCodeView) : "liste",
  };
}

/** ART-019 — le jeu filtré se lit dans l'adresse ; la vue et la recherche partagent la même requête. */
export function hsCodeFiltersQuery(filters: HsCodeFilters): string {
  const params = new URLSearchParams();

  if (filters.search !== "") params.set("q", filters.search);
  if (filters.level !== null) params.set("niveau", String(filters.level));
  if (filters.tec) params.set("tec", filters.tec);
  if (filters.usage) params.set("usage", filters.usage);
  if (filters.view !== "liste") params.set("vue", filters.view);

  return params.toString();
}

/** ART-019 — les filtres se lisent dans l'adresse et se partagent tels quels. */
export function hsCodesHref(
  filters: HsCodeFilters,
  overrides: Partial<HsCodeFilters> = {},
): string {
  const query = hsCodeFiltersQuery({ ...filters, ...overrides });
  return query === "" ? "/nomenclature" : `/nomenclature?${query}`;
}

/** Le bouton « effacer » n'a de sens que si au moins un filtre ou une vue est sorti du repos. */
export function hasActiveHsCodeFilters(filters: HsCodeFilters): boolean {
  return (
    filters.search !== "" ||
    filters.level !== null ||
    filters.tec !== null ||
    filters.usage !== null ||
    filters.view !== "liste"
  );
}
