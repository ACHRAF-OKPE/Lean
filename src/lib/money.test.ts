import { describe, expect, it } from "vitest";
import { formatXof } from "./money";

const normalizeSpaces = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

describe("formatXof", () => {
  it("formate un montant XOF sans décimales", () => {
    expect(normalizeSpaces(formatXof(1_250_000))).toBe("1 250 000 F CFA");
  });

  it("gère zéro et les montants négatifs", () => {
    expect(normalizeSpaces(formatXof(0))).toBe("0 F CFA");
    expect(normalizeSpaces(formatXof(-45_000))).toBe("-45 000 F CFA");
  });

  it("refuse tout montant non entier", () => {
    expect(() => formatXof(12.5)).toThrow(RangeError);
    expect(() => formatXof(Number.NaN)).toThrow(RangeError);
    expect(() => formatXof(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
