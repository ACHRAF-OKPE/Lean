import { describe, expect, it } from "vitest";
import {
  EMPTY_PARTNER_FILTERS,
  hasActivePartnerFilters,
  parsePartnerFilters,
  partnersExportHref,
  partnersHref,
} from "./filters";

describe("ART-010 — les filtres se lisent dans l'adresse", () => {
  it("reconnaît la recherche, les rôles, l'état, le pays et la vue", () => {
    expect(
      parsePartnerFilters({
        q: "  sahel  ",
        role: ["client", "fournisseur", "admin"],
        etat: "Actif",
        pays: "ci",
        vue: "kanban",
      }),
    ).toEqual({
      search: "sahel",
      roles: ["client", "fournisseur"],
      state: "actif",
      categoryIds: [],
      countryCode: "CI",
      ids: [],
      view: "kanban",
    });
  });

  it("abandonne ce qui n'est pas une valeur connue", () => {
    expect(
      parsePartnerFilters({
        q: "x".repeat(90),
        etat: "archive",
        pays: "CIV",
        vue: "tableau",
        categorie: ["pas-un-uuid", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        id: "zzzz",
      }),
    ).toMatchObject({
      search: "x".repeat(80),
      state: null,
      countryCode: null,
      view: "liste",
      categoryIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      ids: [],
    });
  });

  it("transporte les filtres dans l'adresse partageable, sans la vue liste par défaut", () => {
    const filters = parsePartnerFilters({ q: "nord", role: "client", vue: "carte" });
    expect(partnersHref(filters)).toBe("/tiers?q=nord&role=client&vue=carte");
    expect(partnersHref(filters, { view: "liste" })).toBe("/tiers?q=nord&role=client");
    expect(partnersHref(EMPTY_PARTNER_FILTERS)).toBe("/tiers");
  });

  it("ajoute les identifiants retenus à l'export sans perdre le jeu filtré", () => {
    const filters = parsePartnerFilters({ etat: "actif", vue: "kanban" });
    expect(partnersExportHref(filters, ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"])).toBe(
      "/api/export/tiers?etat=actif&vue=kanban&id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
  });

  it("sait dire si un filtre ou une vue est sorti du repos", () => {
    expect(hasActivePartnerFilters(EMPTY_PARTNER_FILTERS)).toBe(false);
    expect(hasActivePartnerFilters({ ...EMPTY_PARTNER_FILTERS, view: "carte" })).toBe(true);
    expect(hasActivePartnerFilters({ ...EMPTY_PARTNER_FILTERS, search: "a" })).toBe(true);
  });
});
