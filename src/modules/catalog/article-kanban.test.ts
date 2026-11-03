import { describe, expect, it } from "vitest";
import { groupArticlesByCategory, UNGROUPED_COLUMN } from "./article-kanban";

const A = {
  id: "a",
  code: "ART001",
  name: "Café vert",
  type: "product" as const,
  unitCode: "KG",
  salePriceXof: 1500,
  active: true,
};

const B = { ...A, id: "b", code: "ART002", name: "Transport", type: "service" as const };

describe("ART-014 — Kanban groupé par catégorie d'articles", () => {
  it("ouvre une colonne par catégorie et range « Sans catégorie » à la fin", () => {
    const columns = groupArticlesByCategory(
      [A, B],
      new Map([[A.id, [{ id: "c1", title: "Denrées" }]]]),
    );
    expect(columns.map((column) => column.title)).toEqual(["Denrées", UNGROUPED_COLUMN]);
    expect(columns[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(columns[1]?.items.map((item) => item.id)).toEqual(["b"]);
  });

  it("duplique un article qui porte plusieurs catégories", () => {
    const columns = groupArticlesByCategory(
      [A],
      new Map([
        [
          A.id,
          [
            { id: "c1", title: "Denrées" },
            { id: "c2", title: "Import" },
          ],
        ],
      ]),
    );
    expect(columns.map((column) => column.title)).toEqual(["Denrées", "Import"]);
    expect(columns.every((column) => column.items[0]?.id === "a")).toBe(true);
  });
});
