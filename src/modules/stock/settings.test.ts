import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, stockSettings } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant } from "@/test/purchases";
import { ensureDefaultLocations } from "./locations";
import { getStockSettingsView, loadStockSettings, saveStockSettings } from "./settings";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("STK-004 — paramétrage du stock", () => {
  it("crée puis met à jour le paramétrage, avec audit et valeurs par défaut", async () => {
    const ids = await seedPurchasingTenant(db, "stk004-save");
    const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));

    expect(await loadStockSettings(db, ids.tenantId)).toBeNull();

    const created = await saveStockSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        defaultInternalLocationId: defaults.internalId,
        defaultMinStockQty: "12",
        adjustmentReasonRequired: false,
      },
    });
    expect(created).toEqual({ created: true });

    const settings = await loadStockSettings(db, ids.tenantId);
    expect(settings).toMatchObject({
      defaultInternalLocationId: defaults.internalId,
      defaultMinStockQty: "12",
      adjustmentReasonRequired: false,
    });

    const view = await getStockSettingsView(db, ids.tenantId);
    expect(view?.defaultLocationCode).toBe("MAG");
    expect(view?.defaultLocationName).toBe("Magasin principal");

    const updated = await saveStockSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        defaultInternalLocationId: "",
        defaultMinStockQty: "0",
        adjustmentReasonRequired: true,
      },
    });
    expect(updated).toEqual({ created: false });
    expect(await loadStockSettings(db, ids.tenantId)).toMatchObject({
      defaultInternalLocationId: null,
      defaultMinStockQty: "0",
      adjustmentReasonRequired: true,
    });

    const rows = await db
      .select({ value: stockSettings.id })
      .from(stockSettings)
      .where(eq(stockSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "stock.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse un magasin par défaut non interne ou introuvable et un seuil invalide", async () => {
    const ids = await seedPurchasingTenant(db, "stk004-refusals");
    const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));

    await expect(
      saveStockSettings(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          defaultInternalLocationId: defaults.supplierId,
          defaultMinStockQty: "0",
          adjustmentReasonRequired: true,
        },
      }),
    ).rejects.toThrow(/emplacement interne/);

    await expect(
      saveStockSettings(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          defaultInternalLocationId: "00000000-0000-0000-0000-000000000000",
          defaultMinStockQty: "0",
          adjustmentReasonRequired: true,
        },
      }),
    ).rejects.toThrow(/introuvable/);

    await expect(
      saveStockSettings(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          defaultInternalLocationId: defaults.internalId,
          defaultMinStockQty: "abc",
          adjustmentReasonRequired: true,
        },
      }),
    ).rejects.toThrow(/nombre décimal/);

    const rows = await db
      .select({ value: stockSettings.id })
      .from(stockSettings)
      .where(eq(stockSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(0);
  });
});
