import { describe, expect, it } from "vitest";
import {
  EMPTY_ARTICLE_FILTERS,
  articlesExportHref,
  articlesHref,
  hasActiveArticleFilters,
  parseArticleFilters,
} from "./article-filters";

describe("ART-013 — les filtres d'articles se lisent dans l'adresse", () => {
  it("reconnaît la recherche, les types, l'état, la catégorie et la vue", () => {
    expect(
      parseArticleFilters({
        q: "  café  ",
        type: ["product", "service", "inconnu"],
        etat: "Actif",
        categorie: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        vue: "kanban",
      }),
    ).toEqual({
      search: "café",
      types: ["product", "service"],
      state: "actif",
      categoryIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      ids: [],
      view: "kanban",
    });
  });

  it("abandonne ce qui n'est pas une valeur connue", () => {
    expect(
      parseArticleFilters({
        q: "x".repeat(90),
        etat: "archive",
        vue: "tableau",
        categorie: ["pas-un-uuid", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        id: "zzzz",
      }),
    ).toMatchObject({
      search: "x".repeat(80),
      state: null,
      view: "liste",
      categoryIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      ids: [],
    });
  });

  it("transporte les filtres dans l'adresse partageable, sans la vue liste par défaut", () => {
    const filters = parseArticleFilters({ q: "café", type: "product", vue: "grille" });
    expect(articlesHref(filters)).toBe("/articles?q=caf%C3%A9&type=product&vue=grille");
    expect(articlesHref(filters, { view: "liste" })).toBe("/articles?q=caf%C3%A9&type=product");
    expect(articlesHref(EMPTY_ARTICLE_FILTERS)).toBe("/articles");
  });

  it("ajoute les identifiants retenus à l'export sans perdre le jeu filtré", () => {
    const filters = parseArticleFilters({ etat: "actif", vue: "kanban" });
    expect(articlesExportHref(filters, ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"])).toBe(
      "/api/export/articles?etat=actif&vue=kanban&id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
  });

  it("sait dire si un filtre ou une vue est sorti du repos", () => {
    expect(hasActiveArticleFilters(EMPTY_ARTICLE_FILTERS)).toBe(false);
    expect(hasActiveArticleFilters({ ...EMPTY_ARTICLE_FILTERS, view: "grille" })).toBe(true);
    expect(hasActiveArticleFilters({ ...EMPTY_ARTICLE_FILTERS, types: ["product"] })).toBe(true);
  });
});
