import { describe, expect, it } from "vitest";
import { CustomsError } from "./errors";
import { allocateProRata, liquidateDeclaration } from "./liquidation";

describe("CUS-003 — répartition et liquidation", () => {
  it("répartit un montant au prorata des valeurs et attribue le reste au plus fort reste", () => {
    expect(allocateProRata(100, [333, 333, 334])).toEqual([33, 33, 34]);
    expect(allocateProRata(0, [10, 20])).toEqual([0, 0]);
    expect(allocateProRata(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateProRata(7, [])).toEqual([]);
  });

  it("calcule CIF, droits TEC arrondis au demi-supérieur et taxes configurables", () => {
    const result = liquidateDeclaration({
      freightAmountXof: 300_000,
      insuranceAmountXof: 30_000,
      lines: [
        { lineNumber: 1, valueXof: 1_000_000, tecRate: 10 },
        { lineNumber: 2, valueXof: 2_000_000, tecRate: 20 },
      ],
      taxes: [
        { code: "TVA", label: "TVA", base: "cif_plus_duty", rateBp: 1800, position: 20 },
        { code: "PCS", label: "PCS", base: "cif", rateBp: 100, position: 10 },
      ],
    });

    expect(result.lines).toEqual([
      { lineNumber: 1, cifValue: 1_110_000, dutyRate: 10, dutyAmount: 111_000 },
      { lineNumber: 2, cifValue: 2_220_000, dutyRate: 20, dutyAmount: 444_000 },
    ]);
    expect(result.cifTotal).toBe(3_330_000);
    expect(result.dutyTotal).toBe(555_000);
    expect(result.taxes.map((tax) => [tax.code, tax.baseAmount, tax.amount])).toEqual([
      ["PCS", 3_330_000, 33_300],
      ["TVA", 3_885_000, 699_300],
    ]);
    expect(result.taxTotal).toBe(732_600);
    expect(result.grandTotal).toBe(1_287_600);
  });

  it("arrondit chaque droit au demi-supérieur en entiers XOF", () => {
    const result = liquidateDeclaration({
      freightAmountXof: 0,
      insuranceAmountXof: 0,
      lines: [{ lineNumber: 1, valueXof: 10, tecRate: 5 }],
      taxes: [],
    });

    expect(result.lines[0]).toEqual({
      lineNumber: 1,
      cifValue: 10,
      dutyRate: 5,
      dutyAmount: 1,
    });
    expect(result.grandTotal).toBe(1);
  });

  it("refuse une ligne sans taux TEC en nommant la ligne", () => {
    expect(() =>
      liquidateDeclaration({
        freightAmountXof: 0,
        insuranceAmountXof: 0,
        lines: [
          { lineNumber: 1, valueXof: 1_000, tecRate: 10 },
          { lineNumber: 2, valueXof: 2_000, tecRate: null },
        ],
        taxes: [],
      }),
    ).toThrow(/lignes 2/);
  });

  it("refuse une déclaration vide ou des frais hors limite", () => {
    expect(() =>
      liquidateDeclaration({
        freightAmountXof: 0,
        insuranceAmountXof: 0,
        lines: [],
        taxes: [],
      }),
    ).toThrow(CustomsError);

    expect(() =>
      liquidateDeclaration({
        freightAmountXof: -1,
        insuranceAmountXof: 0,
        lines: [{ lineNumber: 1, valueXof: 1_000, tecRate: 10 }],
        taxes: [],
      }),
    ).toThrow(/Frais de transport/);
  });

  it("refuse un taux de taxe hors bornes", () => {
    expect(() =>
      liquidateDeclaration({
        freightAmountXof: 0,
        insuranceAmountXof: 0,
        lines: [{ lineNumber: 1, valueXof: 1_000, tecRate: 10 }],
        taxes: [{ code: "X", label: "Taxe", base: "cif", rateBp: 10_001, position: 1 }],
      }),
    ).toThrow(/Taxe X/);
  });
});
