import { describe, expect, it } from "vitest";
import {
  addQuantity,
  compareQuantity,
  computeLineTotal,
  formatQuantity,
  parseQuantity,
  quantityToMicros,
  remainingQuantity,
  subtractQuantity,
} from "./quantities";

describe("quantités — PUR-001 et PUR-004", () => {
  it("accepte six décimales et convertit la virgule en avertissement", () => {
    const result = parseQuantity("1,250000", "Quantité");
    expect(result.errors).toEqual([]);
    expect(result.value).toBe("1.25");
    expect(result.warnings.join(" ")).toMatch(/virgule/);
  });

  it("refuse zéro, négatif, sept décimales, exposant et séparateur de milliers", () => {
    expect(parseQuantity("0").errors.length).toBeGreaterThan(0);
    expect(parseQuantity("-1").errors.length).toBeGreaterThan(0);
    expect(parseQuantity("1.1234567").errors.join(" ")).toMatch(/6 décimales/);
    expect(parseQuantity("1e3").errors.length).toBeGreaterThan(0);
    expect(parseQuantity("1 000").errors.length).toBeGreaterThan(0);
  });

  it("borne la quantité à un milliard", () => {
    expect(parseQuantity("1000000000").errors).toEqual([]);
    expect(parseQuantity("1000000001").errors.join(" ")).toMatch(/1000000000/);
  });

  it("calcule le total de ligne en HALF_UP sans flottants", () => {
    expect(computeLineTotal("3", 1000)).toBe(3000);
    expect(computeLineTotal("1.5", 999)).toBe(1499);
    expect(computeLineTotal("0.000001", 500000)).toBe(1);
    expect(computeLineTotal("0.000001", 499999)).toBe(0);
  });

  it("additionne et soustrait des quantités exactes", () => {
    expect(addQuantity("0.1", "0.2")).toBe("0.3");
    expect(subtractQuantity("5", "2.5")).toBe("2.5");
    expect(subtractQuantity("1", "2")).toBe("-1");
    expect(compareQuantity("5.000000", "5")).toBe(0);
    expect(remainingQuantity("5", "2.5")).toBe("2.5");
    expect(remainingQuantity("5", "6")).toBe("0");
    expect(quantityToMicros("1.000001")).toBe(1_000_001n);
  });

  it("formate les quantités en français", () => {
    expect(formatQuantity("1234.5")).toBe("1\u202f234,5");
    expect(formatQuantity("10.000000")).toBe("10");
  });
});
