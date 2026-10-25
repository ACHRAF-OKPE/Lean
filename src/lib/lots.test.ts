import { describe, expect, it } from "vitest";
import { LOTS } from "./lots";

describe("plan de lots", () => {
  it("numérote les lots de 0 à 7 sans trou ni doublon", () => {
    const ids = LOTS.map((lot) => lot.id);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("donne à chaque lot un titre et un périmètre non vides", () => {
    for (const lot of LOTS) {
      expect(lot.title.trim()).not.toBe("");
      expect(lot.scope.trim()).not.toBe("");
    }
  });
});
