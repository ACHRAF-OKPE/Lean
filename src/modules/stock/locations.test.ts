import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, stockLevels, stockLocations } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import {
  createStockLocation,
  ensureDefaultLocations,
  getStockLocationDetail,
  listInternalLocations,
  listStockLocations,
  setStockLocationActive,
  updateStockLocation,
} from "./locations";
import { saveStockSettings } from "./settings";
import { StockError } from "./errors";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

async function newLocation(ids: PurchasingTenant, code: string, name: string): Promise<string> {
  const created = await createStockLocation(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: { code, name },
  });
  return created.id;
}

async function auditActions(ids: PurchasingTenant): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityType, "stock_locations")),
    )
    .orderBy(asc(auditEvents.createdAt));
  return rows.map((row) => row.action);
}

describe("STK-005 — registre des magasins", () => {
  it("crée un magasin interne actif, normalise le code et écrit l'audit", async () => {
    const ids = await seedPurchasingTenant(db, "stk005-create");

    const locationId = await newLocation(ids, "mag2", "Entrepôt Nord");

    const [row] = await db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, ids.tenantId), eq(stockLocations.id, locationId)));
    expect(row?.code).toBe("MAG2");
    expect(row?.name).toBe("Entrepôt Nord");
    expect(row?.type).toBe("internal");
    expect(row?.active).toBe(true);

    const locations = await listStockLocations(db, ids.tenantId);
    const codes = locations.map((location) => location.code).sort();
    expect(codes).toEqual(["MAG", "MAG2"]);
    expect(locations.find((location) => location.code === "MAG2")).toMatchObject({
      articleCount: 0,
      totalQuantity: "0",
      moveCount: 0,
    });

    expect(await auditActions(ids)).toEqual(["stock.location.create"]);
  });

  it("refuse un code déjà utilisé, un code invalide et un nom vide", async () => {
    const ids = await seedPurchasingTenant(db, "stk005-refusals");
    await newLocation(ids, "MAG2", "Entrepôt Nord");

    await expect(newLocation(ids, "MAG2", "Doublon")).rejects.toThrow(/déjà utilisé/);
    await expect(newLocation(ids, "@@", "Code invalide")).rejects.toThrow(StockError);
    await expect(newLocation(ids, "MAG3", "   ")).rejects.toThrow(/1 à 80 caractères/);
  });

  it("met à jour le libellé sans toucher au code et audite la mutation", async () => {
    const ids = await seedPurchasingTenant(db, "stk005-update");
    const locationId = await newLocation(ids, "MAG2", "Entrepôt Nord");

    await updateStockLocation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      locationId,
      raw: { name: "Entrepôt Sud" },
    });

    const [row] = await db
      .select({ code: stockLocations.code, name: stockLocations.name })
      .from(stockLocations)
      .where(eq(stockLocations.id, locationId));
    expect(row).toEqual({ code: "MAG2", name: "Entrepôt Sud" });
    expect(await auditActions(ids)).toEqual(["stock.location.create", "stock.location.update"]);

    await expect(
      updateStockLocation(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        locationId: "00000000-0000-0000-0000-000000000000",
        raw: { name: "Ailleurs" },
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it("détaille un magasin interne et ignore les emplacements virtuels", async () => {
    const ids = await seedPurchasingTenant(db, "stk005-detail");
    const locationId = await newLocation(ids, "MAG2", "Entrepôt Nord");
    const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));

    const detail = await getStockLocationDetail(db, ids.tenantId, locationId);
    expect(detail?.code).toBe("MAG2");
    expect(detail?.levels).toEqual([]);
    expect(detail?.moves).toEqual([]);

    expect(await getStockLocationDetail(db, ids.tenantId, defaults.supplierId)).toBeNull();
    expect(await getStockLocationDetail(db, ids.tenantId, defaults.inventoryId)).toBeNull();

    const internals = await listInternalLocations(db, ids.tenantId);
    expect(internals.map((location) => location.code).sort()).toEqual(["MAG", "MAG2"]);
  });
});

describe("STK-006 — refus de désactivation", () => {
  it("refuse un magasin qui porte encore du stock", async () => {
    const ids = await seedPurchasingTenant(db, "stk006-stock");
    await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
    const locationId = await newLocation(ids, "MAG2", "Entrepôt Nord");
    await newLocation(ids, "MAG3", "Entrepôt Sud");
    await db
      .insert(stockLevels)
      .values({ tenantId: ids.tenantId, locationId, articleId: ids.productId, quantity: "5" });

    await expect(
      setStockLocationActive(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        locationId,
        active: false,
      }),
    ).rejects.toThrow(/porte encore du stock/);
  });

  it("refuse le magasin par défaut et le dernier magasin actif", async () => {
    const ids = await seedPurchasingTenant(db, "stk006-default");
    const only = await newLocation(ids, "MAG2", "Entrepôt Nord");
    await newLocation(ids, "MAG3", "Entrepôt Sud");
    await saveStockSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        defaultInternalLocationId: only,
        defaultMinStockQty: "0",
        adjustmentReasonRequired: true,
      },
    });

    await expect(
      setStockLocationActive(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        locationId: only,
        active: false,
      }),
    ).rejects.toThrow(/magasin par défaut/);

    const ids2 = await seedPurchasingTenant(db, "stk006-last");
    const single = await newLocation(ids2, "MAG2", "Unique");
    await expect(
      setStockLocationActive(db, {
        tenantId: ids2.tenantId,
        actorUserId: ids2.userId,
        locationId: single,
        active: false,
      }),
    ).rejects.toThrow(/dernier magasin actif/);
  });

  it("désactive puis réactive un magasin libre en l'auditant", async () => {
    const ids = await seedPurchasingTenant(db, "stk006-toggle");
    await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
    const locationId = await newLocation(ids, "MAG2", "Entrepôt Nord");

    await setStockLocationActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      locationId,
      active: false,
    });
    let [row] = await db
      .select({ active: stockLocations.active })
      .from(stockLocations)
      .where(eq(stockLocations.id, locationId));
    expect(row?.active).toBe(false);

    await setStockLocationActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      locationId,
      active: true,
    });
    [row] = await db
      .select({ active: stockLocations.active })
      .from(stockLocations)
      .where(eq(stockLocations.id, locationId));
    expect(row?.active).toBe(true);

    const [latest] = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityType, "stock_locations"))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    expect(latest?.action).toBe("stock.location.activate");
    expect(await auditActions(ids)).toEqual([
      "stock.location.create",
      "stock.location.deactivate",
      "stock.location.activate",
    ]);
  });
});
