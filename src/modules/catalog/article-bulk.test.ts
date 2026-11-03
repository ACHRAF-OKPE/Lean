import { describe, expect, it } from "vitest";
import { isArticleBulkActionAllowed, planArticleBulk } from "./article-bulk";

const LINE = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  code: "ART001",
  name: "Café vert",
  references: [] as string[],
};

describe("GEN-017 — plan d'une action en lot sur des articles", () => {
  it("refuse une sélection vide avant d'écrire", () => {
    expect(
      planArticleBulk({ action: "activer", lines: [LINE], level: "write", selectedIds: [] }),
    ).toEqual({ ok: false, errors: ["Aucun article sélectionné."] });
  });

  it("refuse l'action quand le niveau manque, sans regarder les lignes", () => {
    const plan = planArticleBulk({
      action: "supprimer",
      lines: [LINE],
      level: "write",
      selectedIds: [LINE.id],
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors[0]).toMatch(/niveau de droit plus élevé/);
    }
  });

  it("refuse toute la sélection si un article est cité par un document", () => {
    const plan = planArticleBulk({
      action: "supprimer",
      level: "manage",
      selectedIds: [LINE.id],
      lines: [{ ...LINE, references: ["lignes de commandes de vente (2)"] }],
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors[0]).toMatch(
        /ART001 · Café vert : rattaché à lignes de commandes de vente/,
      );
    }
  });

  it("accepte le lot quand chaque ligne est libre", () => {
    expect(
      planArticleBulk({
        action: "desactiver",
        lines: [LINE],
        level: "write",
        selectedIds: [LINE.id],
      }),
    ).toEqual({ ok: true, ids: [LINE.id] });
  });

  it("masque les commandes hors niveau", () => {
    expect(isArticleBulkActionAllowed("exporter", "read")).toBe(true);
    expect(isArticleBulkActionAllowed("categories", "read")).toBe(false);
    expect(isArticleBulkActionAllowed("categories", "write")).toBe(true);
    expect(isArticleBulkActionAllowed("supprimer", "write")).toBe(false);
    expect(isArticleBulkActionAllowed("supprimer", "manage")).toBe(true);
  });
});
