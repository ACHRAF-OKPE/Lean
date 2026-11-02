import { describe, expect, it } from "vitest";
import { isBulkActionAllowed, planPartnerBulk } from "./bulk";

const LINE = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  code: "CLI001",
  name: "Sahel",
  references: [] as string[],
};

describe("GEN-017 — plan d'une action en lot", () => {
  it("refuse une sélection vide avant d'écrire", () => {
    expect(
      planPartnerBulk({ action: "activer", lines: [LINE], level: "write", selectedIds: [] }),
    ).toEqual({ ok: false, errors: ["Aucun tiers sélectionné."] });
  });

  it("refuse l'action quand le niveau manque, sans regarder les lignes", () => {
    const plan = planPartnerBulk({
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

  it("refuse toute la sélection si un tiers est cité par un document", () => {
    const plan = planPartnerBulk({
      action: "supprimer",
      level: "manage",
      selectedIds: [LINE.id],
      lines: [{ ...LINE, references: ["commandes d'achat (1)"] }],
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors[0]).toMatch(/CLI001 · Sahel : rattaché à commandes d'achat/);
    }
  });

  it("accepte le lot quand chaque ligne est libre", () => {
    expect(
      planPartnerBulk({
        action: "desactiver",
        lines: [LINE],
        level: "write",
        selectedIds: [LINE.id],
      }),
    ).toEqual({ ok: true, ids: [LINE.id] });
  });

  it("masque les commandes hors niveau", () => {
    expect(isBulkActionAllowed("exporter", "read")).toBe(true);
    expect(isBulkActionAllowed("activer", "read")).toBe(false);
    expect(isBulkActionAllowed("supprimer", "write")).toBe(false);
    expect(isBulkActionAllowed("supprimer", "manage")).toBe(true);
  });
});
