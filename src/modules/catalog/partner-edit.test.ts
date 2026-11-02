import { describe, expect, it } from "vitest";
import { validatePartnerEdit } from "./partner-edit";

describe("ART-001 + ART-009 — correction d'une fiche tiers", () => {
  it("accepte une fiche complète avec ses coordonnées", () => {
    const result = validatePartnerEdit({
      nom: "Sahel Distribution",
      type: "Entreprise",
      client: "on",
      fournisseur: "",
      latitude: "5.35",
      longitude: "-4.01",
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      name: "Sahel Distribution",
      type: "company",
      isCustomer: true,
      latitude: "5.35",
      longitude: "-4.01",
    });
  });

  it("refuse un nom vide, l'absence de rôle et une latitude hors borne", () => {
    const result = validatePartnerEdit({
      nom: "  ",
      type: "Société",
      latitude: "100",
      longitude: "0",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Le nom du tiers est obligatoire.",
        "Le type du tiers est Entreprise ou Particulier.",
        "Un tiers est au moins client ou fournisseur.",
        "La latitude « 100 » est hors de l'intervalle −90…90.",
      ]),
    );
  });
});
