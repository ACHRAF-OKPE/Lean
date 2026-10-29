import { describe, expect, it } from "vitest";
import {
  apurementContextError,
  declarationApurementProgress,
  lineApurementProgress,
  normalizeApurementMode,
} from "./apurement";

describe("CUS-007 — calculs d'apurement progressif", () => {
  it("normalise les modes d'apurement et rejette les inconnus", () => {
    expect(normalizeApurementMode("Production")).toBe("production");
    expect(normalizeApurementMode(" EXPORTATION ")).toBe("export");
    expect(normalizeApurementMode("Transfert")).toBe("transfer");
    expect(normalizeApurementMode("destruction")).toBe("destruction");
    expect(normalizeApurementMode("vente")).toBeNull();
    expect(normalizeApurementMode(undefined)).toBeNull();
  });

  it("déduit l'état et le restant d'une ligne, sans dépasser la quantité déclarée", () => {
    expect(lineApurementProgress("10", "0")).toEqual({
      apuredQuantity: "0",
      remainingQuantity: "10",
      rateBp: 0,
      state: "open",
    });
    expect(lineApurementProgress("10", "2.5")).toEqual({
      apuredQuantity: "2.5",
      remainingQuantity: "7.5",
      rateBp: 2500,
      state: "partial",
    });
    expect(lineApurementProgress("10", "10")).toEqual({
      apuredQuantity: "10",
      remainingQuantity: "0",
      rateBp: 10_000,
      state: "apured",
    });
    expect(lineApurementProgress("10", "12")).toMatchObject({
      apuredQuantity: "10",
      remainingQuantity: "0",
      rateBp: 10_000,
      state: "apured",
    });
  });

  it("agrège une déclaration homogène et refuse les totaux sur unités mixtes", () => {
    const single = declarationApurementProgress(
      [
        { quantity: "10", apuredQuantity: "10", unitCode: "KG" },
        { quantity: "5", apuredQuantity: "0", unitCode: "KG" },
      ],
      true,
    );
    expect(single).toMatchObject({
      state: "partial",
      lineCount: 2,
      apuredLineCount: 1,
      partialLineCount: 0,
      unitCode: "KG",
      apuredQuantity: "10",
      remainingQuantity: "5",
      averageRateBp: 5000,
    });

    const mixed = declarationApurementProgress(
      [
        { quantity: "10", apuredQuantity: "10", unitCode: "KG" },
        { quantity: "5", apuredQuantity: "5", unitCode: "PCE" },
      ],
      true,
    );
    expect(mixed).toMatchObject({
      state: "apured",
      unitCode: null,
      apuredQuantity: null,
      remainingQuantity: null,
    });

    const notRequired = declarationApurementProgress([], false);
    expect(notRequired).toMatchObject({ state: "not_required", averageRateBp: 0 });
  });

  it("refuse un apurement hors régime, hors liquidation, nul ou excédentaire", () => {
    const base = {
      requiresApurement: true,
      status: "liquidated" as const,
      lineQuantity: "10",
      apuredQuantity: "4",
      requestedQuantity: "3",
      unitCode: "KG",
    };
    expect(apurementContextError(base)).toBeNull();
    expect(apurementContextError({ ...base, requiresApurement: false })).toMatch(/ne prévoit pas/);
    expect(apurementContextError({ ...base, status: "deposited" })).toMatch(/doit être liquidée/);
    expect(apurementContextError({ ...base, requestedQuantity: "0" })).toMatch(
      /strictement positive/,
    );
    expect(apurementContextError({ ...base, requestedQuantity: "7" })).toMatch(
      /dépasse le restant de la ligne \(restant 6 KG\)/,
    );
  });
});
