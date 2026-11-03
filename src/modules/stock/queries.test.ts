import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { todayIsoDate } from "@/lib/dates";
import { createStockLocation, ensureDefaultLocations } from "./locations";
import { createAdjustment, createTransfer } from "./operations";
import { EMPTY_STOCK_FILTERS, parseStockFilters } from "./filters";
import { getStockValuation, listStockMoves } from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

interface RegistryFixture {
  readonly secondId: string;
  readonly transferNumber: string;
  readonly adjustmentNumber: string;
}

async function buildRegistry(ids: PurchasingTenant): Promise<RegistryFixture> {
  const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
  const created = await createStockLocation(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: { code: "MAG2", name: "Entrepôt Nord" },
  });

  const adjustment = await createAdjustment(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    locationId: defaults.internalId,
    direction: "in",
    reason: "Inventaire de départ",
    realDate: todayIsoDate(),
    lines: [
      { articleId: ids.productId, qty: "10" },
      { articleId: ids.secondProductId, qty: "4" },
    ],
  });
  const transfer = await createTransfer(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    fromLocationId: defaults.internalId,
    toLocationId: created.id,
    realDate: todayIsoDate(),
    notes: "Réappro",
    lines: [{ articleId: ids.productId, qty: "3" }],
  });

  return {
    secondId: created.id,
    transferNumber: transfer.number,
    adjustmentNumber: adjustment.number,
  };
}

describe("STK-009 — registre filtré des mouvements", () => {
  it("filtre par texte, magasin, type et période, en comptant les lignes", async () => {
    const ids = await seedPurchasingTenant(db, "stk009-filters");
    const { secondId, transferNumber, adjustmentNumber } = await buildRegistry(ids);

    const all = await listStockMoves(db, ids.tenantId, EMPTY_STOCK_FILTERS);
    expect(all.total).toBe(3);
    expect(all.rows).toHaveLength(3);
    expect(all.limit).toBe(200);

    const transfers = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      type: "transfer",
    });
    expect(transfers.rows.map((row) => row.number)).toEqual([transferNumber]);
    expect(transfers.rows[0]?.cancellable).toBe(true);

    const atSecond = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      locationId: secondId,
    });
    expect(atSecond.rows.map((row) => row.number)).toEqual([transferNumber]);

    const byNumber = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      search: transferNumber,
    });
    expect(byNumber.rows).toHaveLength(1);

    const byArticle = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      search: "ART002",
    });
    expect(byArticle.rows).toHaveLength(1);
    expect(byArticle.rows[0]?.number).toBe(adjustmentNumber);
    expect(byArticle.rows[0]?.articleCode).toBe("ART002");

    const future = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      from: "2099-01-01",
    });
    expect(future.total).toBe(0);
    expect(future.rows).toHaveLength(0);

    const past = await listStockMoves(db, ids.tenantId, {
      ...EMPTY_STOCK_FILTERS,
      to: "2000-01-01",
    });
    expect(past.rows).toHaveLength(0);
  });

  it("ne relit que les valeurs connues de l'adresse", () => {
    const filters = parseStockFilters({
      q: "  café ",
      magasin: "pas-un-uuid",
      type: "inconnu",
      du: "hier",
      au: "2026-11-03",
      vue: "grille",
    });
    expect(filters).toEqual({
      search: "café",
      locationId: null,
      type: null,
      from: null,
      to: "2026-11-03",
      view: "grille",
    });
  });
});

describe("STK-010 — valorisation au prix d'achat", () => {
  it("valorise le stock interne par magasin et totalise en XOF", async () => {
    const ids = await seedPurchasingTenant(db, "stk010-valuation");
    await buildRegistry(ids);

    const valuation = await getStockValuation(db, ids.tenantId);
    const byKey = new Map(
      valuation.lines.map((line) => [`${line.locationCode}-${line.articleCode}`, line]),
    );

    expect(byKey.get("MAG-ART001")).toMatchObject({
      quantity: "7",
      unitPriceXof: 1000,
      valueXof: 7000,
    });
    expect(byKey.get("MAG-ART002")).toMatchObject({
      quantity: "4",
      unitPriceXof: 450,
      valueXof: 1800,
    });
    expect(byKey.get("MAG2-ART001")).toMatchObject({
      quantity: "3",
      unitPriceXof: 1000,
      valueXof: 3000,
    });
    expect(valuation.totalXof).toBe(11800);
  });
});
