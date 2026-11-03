import { describe, expect, it } from "vitest";
import {
  categoryTitleErrors,
  isCategorySelectable,
  normalizeCategoryTitle,
  planCategoryDelete,
  sameCategoryTitle,
} from "./categories";

describe("ART-008 — catégories de tiers", () => {
  it("détoure le libellé et refuse le vide", () => {
    expect(normalizeCategoryTitle("  Grossistes   régionaux  ")).toBe("Grossistes régionaux");
    expect(categoryTitleErrors("")).toEqual(["Le libellé de la catégorie est obligatoire."]);
  });

  it("reconnaît deux libellés identiques à la casse près", () => {
    expect(sameCategoryTitle("Grossistes", "grossistes")).toBe(true);
  });

  it("refuse de supprimer une catégorie encore portée", () => {
    expect(planCategoryDelete({ title: "Grossistes", count: 2, subject: "tier(s)" })).toEqual({
      ok: false,
      error: "La catégorie « Grossistes » porte 2 tier(s) : désactivez-la au lieu de la supprimer.",
    });
    expect(planCategoryDelete({ title: "Grossistes", count: 0, subject: "tier(s)" })).toEqual({
      ok: true,
    });
    expect(planCategoryDelete({ title: "Boissons", count: 3, subject: "article(s)" })).toEqual({
      ok: false,
      error:
        "La catégorie « Boissons » porte 3 article(s) : désactivez-la au lieu de la supprimer.",
    });
  });

  it("retire une catégorie désactivée des propositions", () => {
    expect(isCategorySelectable(true)).toBe(true);
    expect(isCategorySelectable(false)).toBe(false);
  });
});
