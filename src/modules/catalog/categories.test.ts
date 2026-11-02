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
    expect(planCategoryDelete({ title: "Grossistes", partnerCount: 2 })).toEqual({
      ok: false,
      error: "La catégorie « Grossistes » porte 2 tier(s) : désactivez-la au lieu de la supprimer.",
    });
    expect(planCategoryDelete({ title: "Grossistes", partnerCount: 0 })).toEqual({ ok: true });
  });

  it("retire une catégorie désactivée des propositions", () => {
    expect(isCategorySelectable(true)).toBe(true);
    expect(isCategorySelectable(false)).toBe(false);
  });
});
