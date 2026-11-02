/** ART-009 — degrés décimaux saisis à la main : point décimal ou virgule, cinq décimales maximum. */
const DEGREE_PATTERN = /^-?\d{1,3}(?:\.\d{1,5})?$/;

export interface ParsedCoordinates {
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly errors: readonly string[];
}

function degree(raw: unknown, label: string, limit: number, errors: string[]): string | null {
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (text === "") {
    return null;
  }
  if (!DEGREE_PATTERN.test(text)) {
    errors.push(
      `La ${label} « ${text} » n'est pas un degré décimal (jusqu'à cinq décimales, signe autorisé).`,
    );
    return null;
  }
  const value = Number(text);
  if (value < -limit || value > limit) {
    errors.push(`La ${label} « ${text} » est hors de l'intervalle −${limit}…${limit}.`);
    return null;
  }
  return text;
}

/** Rien n'est ramené dans la borne ni arrondi : une coordonnée refusée le dit, et la fiche reste inchangée. */
export function parseCoordinates(input: {
  latitude?: unknown;
  longitude?: unknown;
}): ParsedCoordinates {
  const errors: string[] = [];
  const latitude = degree(input.latitude, "latitude", 90, errors);
  const longitude = degree(input.longitude, "longitude", 180, errors);

  if (errors.length === 0 && (latitude === null) !== (longitude === null)) {
    errors.push("Le couple latitude/longitude est incomplet : renseignez les deux ou aucun.");
  }

  return {
    latitude: errors.length > 0 ? null : latitude,
    longitude: errors.length > 0 ? null : longitude,
    errors,
  };
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

/** GEN-016 — projection équirectangulaire maison : aucun fond ni service de tuiles n'est appelé. */
export function projectPoint(latitude: number, longitude: number): ProjectedPoint {
  return {
    x: ((longitude + 180) / 360) * 100,
    y: ((90 - latitude) / 180) * 100,
  };
}

export interface PlaceGroup {
  readonly place: string;
  readonly countryCode: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly rows: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}

/** ART-011 — un point par lieu, avec les tiers qui s'y trouvent ; la moyenne des coordonnées fait le repère. */
export function groupByPlace(
  rows: readonly {
    id: string;
    code: string;
    name: string;
    city: string | null;
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
  }[],
): readonly PlaceGroup[] {
  const groups = new Map<
    string,
    PlaceGroup & { rows: { id: string; code: string; name: string }[] }
  >();

  for (const row of rows) {
    if (row.latitude === null || row.longitude === null) {
      continue;
    }
    const key = `${row.city ?? "—"}|${row.countryCode ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push({ id: row.id, code: row.code, name: row.name });
      continue;
    }
    groups.set(key, {
      place: row.city ?? "Localisation sans ville",
      countryCode: row.countryCode,
      latitude: row.latitude,
      longitude: row.longitude,
      rows: [{ id: row.id, code: row.code, name: row.name }],
    });
  }

  return [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.place.localeCompare(b.place, "fr"),
  );
}

/** ART-011 — l'analytics de la carte : ce qui est posé, ce qui reste à placer. */
export function geolocationStats(
  rows: readonly { readonly latitude: number | null; readonly longitude: number | null }[],
): {
  readonly total: number;
  readonly geolocated: number;
  readonly missing: number;
  readonly places: number;
} {
  const located = rows.filter((row) => row.latitude !== null && row.longitude !== null);
  const places = new Set(located.map((row) => `${row.latitude}|${row.longitude}`));

  return {
    total: rows.length,
    geolocated: located.length,
    missing: rows.length - located.length,
    places: places.size,
  };
}
