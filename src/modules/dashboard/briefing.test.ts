import { describe, expect, it } from "vitest";
import { formatFrenchDate } from "./briefing";

describe("Briefing Matinal — module dashboard", () => {
  it("formate correctement la date ISO en français avec jour et mois", () => {
    expect(formatFrenchDate("2026-11-12")).toBe("Jeudi 12 novembre 2026");
    expect(formatFrenchDate("2026-01-01")).toBe("Jeudi 1 janvier 2026");
    expect(formatFrenchDate("2026-07-14")).toBe("Mardi 14 juillet 2026");
  });

  it("gère gracieusement les chaînes invalides", () => {
    expect(formatFrenchDate("invalide")).toBe("invalide");
  });
});
