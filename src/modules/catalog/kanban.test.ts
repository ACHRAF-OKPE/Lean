import { describe, expect, it } from "vitest";
import { groupPartnersByCategory, UNGROUPED_COLUMN } from "./kanban";

const A = {
  id: "a",
  code: "CLI001",
  name: "Alpha",
  isCustomer: true,
  isSupplier: false,
  city: "Abidjan",
  countryCode: "CI",
  active: true,
};

const B = { ...A, id: "b", code: "FOU001", name: "Beta", isSupplier: true };

describe("ART-011 — Kanban groupé par catégorie", () => {
  it("ouvre une colonne par catégorie et range « Sans catégorie » à la fin", () => {
    const columns = groupPartnersByCategory(
      [A, B],
      new Map([[A.id, [{ id: "c1", title: "Grossistes" }]]]),
    );
    expect(columns.map((column) => column.title)).toEqual(["Grossistes", UNGROUPED_COLUMN]);
    expect(columns[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(columns[1]?.items.map((item) => item.id)).toEqual(["b"]);
  });

  it("duplique un tiers qui porte plusieurs catégories", () => {
    const columns = groupPartnersByCategory(
      [A],
      new Map([
        [
          A.id,
          [
            { id: "c1", title: "Côte d'Ivoire" },
            { id: "c2", title: "Grossistes" },
          ],
        ],
      ]),
    );
    expect(columns.map((column) => column.title)).toEqual(["Côte d'Ivoire", "Grossistes"]);
    expect(columns.every((column) => column.items[0]?.id === "a")).toBe(true);
  });
});
