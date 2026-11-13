import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { formatFrenchDate, getMorningBriefing } from "./briefing";

let context: TestDatabase;

beforeAll(async () => {
  context = await createTestDatabase();
});

afterAll(async () => {
  await context.close();
});

describe("Briefing Matinal — module dashboard", () => {
  it("formate correctement la date ISO en français avec jour et mois", () => {
    expect(formatFrenchDate("2026-11-12")).toBe("Jeudi 12 novembre 2026");
    expect(formatFrenchDate("2026-01-01")).toBe("Jeudi 1 janvier 2026");
    expect(formatFrenchDate("2026-07-14")).toBe("Mardi 14 juillet 2026");
  });

  it("gère gracieusement les chaînes invalides", () => {
    expect(formatFrenchDate("invalide")).toBe("invalide");
  });

  it("exécute toutes les requêtes du briefing sans erreur SQL", async () => {
    const briefing = await getMorningBriefing({
      db: context.db,
      tenantId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      userName: "Test",
    });

    expect(briefing.metrics.matchingDisputesCount).toBe(0);
    expect(briefing.metrics.readyForPaymentCount).toBe(0);
    expect(briefing.metrics.overdueInvoicesCount).toBe(0);
    expect(briefing.alerts).toEqual([]);
    expect(briefing.greeting).toBe("Bonjour Test · Briefing opérationnel");
  });
});
