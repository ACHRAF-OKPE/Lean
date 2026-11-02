import { describe, expect, it } from "vitest";
import { geolocationStats, parseCoordinates, projectPoint } from "./coordinates";

describe("ART-009 — coordonnées saisies à la main", () => {
  it("accepte un couple en degrés décimaux, virgule comprise", () => {
    expect(parseCoordinates({ latitude: "5,35", longitude: "-4.008" })).toEqual({
      latitude: "5.35",
      longitude: "-4.008",
      errors: [],
    });
  });

  it("refuse une valeur hors borne, non numérique ou incomplète, sans la ramener", () => {
    expect(parseCoordinates({ latitude: "91", longitude: "0" }).errors).toContain(
      "La latitude « 91 » est hors de l'intervalle −90…90.",
    );
    expect(parseCoordinates({ latitude: "abc", longitude: "0" }).errors[0]).toMatch(
      /n'est pas un degré/,
    );
    expect(parseCoordinates({ latitude: "5", longitude: "" }).errors).toContain(
      "Le couple latitude/longitude est incomplet : renseignez les deux ou aucun.",
    );
    expect(parseCoordinates({ latitude: "", longitude: "" })).toEqual({
      latitude: null,
      longitude: null,
      errors: [],
    });
  });
});

describe("ART-011 — projection et analytics de la carte", () => {
  it("projette un point sans appeler de service extérieur", () => {
    expect(projectPoint(0, 0)).toEqual({ x: 50, y: 50 });
    expect(projectPoint(90, -180)).toEqual({ x: 0, y: 0 });
  });

  it("compte les tiers géolocalisés, les absents et les lieux distincts", () => {
    expect(
      geolocationStats([
        { latitude: 5.35, longitude: -4.0 },
        { latitude: 5.35, longitude: -4.0 },
        { latitude: 14.7, longitude: -17.4 },
        { latitude: null, longitude: null },
      ]),
    ).toEqual({ total: 4, geolocated: 3, missing: 1, places: 2 });
  });
});
