import { describe, expect, it } from "vitest";
import { normalizeReferenceLabel, resolveReference, suggestReferences } from "./references";

const OPTIONS = [
  { id: "1", label: "Sahel Distribution" },
  { id: "2", label: "Grossiste du Nord" },
  { id: "3", label: "Transports Express" },
];

describe("GEN-015 — reconnaître une référence saisie librement", () => {
  it("ignore la casse et les espaces superflus", () => {
    expect(normalizeReferenceLabel("  SAHEL   distribution  ")).toBe("sahel distribution");
  });

  it("rattache la saisie à la valeur existante plutôt que de la dupliquer", () => {
    expect(resolveReference(" sahel  Distribution ", OPTIONS, true)).toEqual({
      kind: "match",
      option: OPTIONS[0],
    });
  });

  it("propose de créer la valeur inconnue quand l'utilisateur en a le droit", () => {
    expect(resolveReference("Distributeurs régionaux", OPTIONS, true)).toEqual({
      kind: "create",
      label: "Distributeurs régionaux",
    });
  });

  it("dit le refus de créer quand le niveau manque, sans inventer de valeur", () => {
    expect(resolveReference("Distributeurs régionaux", OPTIONS, false)).toEqual({
      kind: "refused",
      label: "Distributeurs régionaux",
    });
  });

  it("ne propose rien sur une saisie vide", () => {
    expect(resolveReference("   ", OPTIONS, true)).toEqual({ kind: "empty" });
  });
});

describe("GEN-015 — suggestions du champ de référence", () => {
  it("filtre les valeurs dont le libellé contient la saisie", () => {
    expect(suggestReferences("distribution", OPTIONS).map((option) => option.id)).toEqual(["1"]);
  });

  it("liste les premières valeurs quand rien n'est saisi", () => {
    expect(suggestReferences("", OPTIONS, 2).map((option) => option.id)).toEqual(["1", "2"]);
  });
});
