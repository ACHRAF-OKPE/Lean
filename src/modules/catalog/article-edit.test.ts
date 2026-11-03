import { describe, expect, it } from "vitest";
import { validateArticleEdit } from "./article-edit";

describe("ART-015 — correction d'une fiche article", () => {
  it("accepte une fiche produit complète et reprend les bornes de la création", () => {
    const result = validateArticleEdit({
      designation: "Café vert",
      type: "Produit",
      unite: "kg",
      code_sh: "0901110000",
      prix_vente_xof: "1500",
      prix_achat_xof: "1200",
      vendable: "on",
      achetable: "on",
      pays_origine: "ci",
      actif: "on",
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      name: "Café vert",
      type: "product",
      unitCode: "KG",
      hsCode: "0901110000",
      salePriceXof: 1500,
      purchasePriceXof: 1200,
      isSellable: true,
      isPurchasable: true,
      countryOfOrigin: "CI",
      active: true,
    });
  });

  it("refuse un service portant un code SH et un montant décimal", () => {
    const result = validateArticleEdit({
      designation: "Transport",
      type: "Service",
      unite: "H87",
      code_sh: "0901110000",
      prix_vente_xof: "12,5",
      vendable: "on",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Un service ne porte jamais de code SH.",
        "Le champ « Prix de vente XOF » est un montant XOF entier, sans décimale.",
      ]),
    );
  });

  it("refuse une désignation vide, l'absence de type, une unité inconnue et un pays hors ISO", () => {
    const result = validateArticleEdit({
      designation: "  ",
      type: "Marchandise",
      unite: "XYZ",
      prix_vente_xof: "0",
      prix_achat_xof: "0",
      pays_origine: "CIV",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "La désignation de l'article est obligatoire.",
        "Le type de l'article est Produit ou Service.",
        "L'unité de l'article ne figure pas dans la liste autorisée.",
        "Un article est au moins vendable ou achetable.",
        "Le pays « CIV » n'est pas un code ISO 3166-1 reconnu.",
      ]),
    );
  });

  it("refuse un produit sans code SH", () => {
    const result = validateArticleEdit({
      designation: "Café vert",
      type: "Produit",
      unite: "KG",
      prix_vente_xof: "1500",
      vendable: "on",
    });
    expect(result.errors).toContain("Code SH : obligatoire pour un produit.");
  });
});
