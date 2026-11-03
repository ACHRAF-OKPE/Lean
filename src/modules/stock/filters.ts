import type { StockMoveType } from "@/db/schema";

/** GEN-016 — les vues proposées sur le registre des mouvements. */
export const STOCK_VIEWS = ["liste", "grille"] as const;
export type StockView = (typeof STOCK_VIEWS)[number];

export const STOCK_MOVE_TYPES: readonly StockMoveType[] = [
  "incoming",
  "outgoing",
  "transfer",
] as const;

/** STK-009 — ce que le registre des mouvements sait filtrer : texte, magasin, type et période. */
export interface StockFilters {
  readonly search: string;
  readonly locationId: string | null;
  readonly type: StockMoveType | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly view: StockView;
}

export const EMPTY_STOCK_FILTERS: StockFilters = {
  search: "",
  locationId: null,
  type: null,
  from: null,
  to: null,
  view: "liste",
};

type RawParams = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined, max: number): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, max);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** STK-009 — rien ne sort de l'URL : ce qui n'est pas une valeur connue est abandonné. */
export function parseStockFilters(raw: RawParams): StockFilters {
  const type = text(raw.type, 12);
  const locationId = text(raw.magasin, 40);
  const from = text(raw.du, 10);
  const to = text(raw.au, 10);
  const view = text(raw.vue, 10);

  return {
    search: text(raw.q, 80),
    locationId: UUID_PATTERN.test(locationId) ? locationId : null,
    type: (STOCK_MOVE_TYPES as readonly string[]).includes(type) ? (type as StockMoveType) : null,
    from: DATE_PATTERN.test(from) ? from : null,
    to: DATE_PATTERN.test(to) ? to : null,
    view: (STOCK_VIEWS as readonly string[]).includes(view) ? (view as StockView) : "liste",
  };
}

/** STK-009 — le jeu filtré se lit dans l'adresse ; la vue choisie survit aux filtres. */
export function stockFiltersQuery(filters: StockFilters): string {
  const params = new URLSearchParams();

  if (filters.search !== "") params.set("q", filters.search);
  if (filters.locationId) params.set("magasin", filters.locationId);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("du", filters.from);
  if (filters.to) params.set("au", filters.to);
  if (filters.view !== "liste") params.set("vue", filters.view);

  return params.toString();
}

export function stockHref(filters: StockFilters, overrides: Partial<StockFilters> = {}): string {
  const query = stockFiltersQuery({ ...filters, ...overrides });
  return query === "" ? "/stock/registre" : `/stock/registre?${query}`;
}

/** Le bouton « effacer » n'a de sens que si au moins un filtre ou la vue est sorti du repos. */
export function hasActiveStockFilters(filters: StockFilters): boolean {
  return (
    filters.search !== "" ||
    filters.locationId !== null ||
    filters.type !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.view !== "liste"
  );
}
