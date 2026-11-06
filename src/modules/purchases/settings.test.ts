import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, purchaseSettings } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant } from "@/test/purchases";
import { PurchaseError } from "./errors";
import { getPurchaseSettingsView, loadPurchaseSettings, savePurchaseSettings } from "./settings";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("PUR-007 — paramétrage des achats", () => {
  it("crée puis met à jour le délai de réception par défaut, avec audit", async () => {
    const ids = await seedPurchasingTenant(db, "pur007-save");

    expect(await loadPurchaseSettings(db, ids.tenantId)).toBeNull();

    const created = await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: "30" },
    });
    expect(created).toEqual({ created: true });
    expect(await loadPurchaseSettings(db, ids.tenantId)).toMatchObject({
      defaultReceiptDelayDays: 30,
    });
    expect((await getPurchaseSettingsView(db, ids.tenantId))?.defaultReceiptDelayDays).toBe(30);

    const updated = await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: "" },
    });
    expect(updated).toEqual({ created: false });
    expect(await loadPurchaseSettings(db, ids.tenantId)).toMatchObject({
      defaultReceiptDelayDays: 0,
    });

    const rows = await db
      .select({ value: purchaseSettings.id })
      .from(purchaseSettings)
      .where(eq(purchaseSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "purchase.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse un délai hors borne, décimal ou non numérique sans rien écrire", async () => {
    const ids = await seedPurchasingTenant(db, "pur007-refusals");

    for (const raw of ["-1", "366", "abc", "12,5"]) {
      await expect(
        savePurchaseSettings(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          raw: { defaultReceiptDelayDays: raw },
        }),
      ).rejects.toThrow(PurchaseError);
    }

    const rows = await db
      .select({ value: purchaseSettings.id })
      .from(purchaseSettings)
      .where(eq(purchaseSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(0);
  });

  it("isole le paramétrage entre deux espaces", async () => {
    const first = await seedPurchasingTenant(db, "pur007-iso-a");
    const second = await seedPurchasingTenant(db, "pur007-iso-b");

    await savePurchaseSettings(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      raw: { defaultReceiptDelayDays: "15" },
    });

    expect(await loadPurchaseSettings(db, second.tenantId)).toBeNull();
    expect((await loadPurchaseSettings(db, first.tenantId))?.defaultReceiptDelayDays).toBe(15);
  });
});
