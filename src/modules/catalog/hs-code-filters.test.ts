import { describe, expect, it } from "vitest";
import {
  EMPTY_HS_CODE_FILTERS,
  hasActiveHsCodeFilters,
  hsCodesHref,
  parseHsCodeFilters,
} from "./hs-code-filters";

describe("ART-019 — les filtres de la nomenclature se lisent dans l'adresse", () => {
  it("reconnaît la recherche, le niveau, le TEC, l'usage et la vue", () => {
    expect(
      parseHsCodeFilters({
        q: "  café  ",
        niveau: "10",
        tec: "present",
        usage: "utilise",
        vue: "arbre",
      }),
    ).toEqual({
      search: "café",
      level: 10,
      tec: "present",
      usage: "utilise",
      view: "arbre",
    });
  });

  it("abandonne ce qui n'est pas une valeur connue", () => {
    expect(
      parseHsCodeFilters({
        q: "x".repeat(90),
        niveau: "9",
        tec: "peut-être",
        usage: "partiel",
        vue: "tableau",
      }),
    ).toEqual({
      search: "x".repeat(80),
      level: null,
      tec: null,
      usage: null,
      view: "liste",
    });
  });

  it("transporte les filtres dans l'adresse partageable, sans la vue liste par défaut", () => {
    const filters = parseHsCodeFilters({ q: "café", niveau: "6", vue: "arbre" });
    expect(hsCodesHref(filters)).toBe("/nomenclature?q=caf%C3%A9&niveau=6&vue=arbre");
    expect(hsCodesHref(filters, { view: "liste" })).toBe("/nomenclature?q=caf%C3%A9&niveau=6");
    expect(hsCodesHref(EMPTY_HS_CODE_FILTERS)).toBe("/nomenclature");
  });

  it("sait dire si un filtre ou une vue est sorti du repos", () => {
    expect(hasActiveHsCodeFilters(EMPTY_HS_CODE_FILTERS)).toBe(false);
    expect(hasActiveHsCodeFilters({ ...EMPTY_HS_CODE_FILTERS, view: "arbre" })).toBe(true);
    expect(hasActiveHsCodeFilters({ ...EMPTY_HS_CODE_FILTERS, tec: "absent" })).toBe(true);
    expect(hasActiveHsCodeFilters({ ...EMPTY_HS_CODE_FILTERS, usage: "libre" })).toBe(true);
  });
});
