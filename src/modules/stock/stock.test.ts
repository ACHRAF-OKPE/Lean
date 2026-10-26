import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  purchaseOrderLines,
  stockLevels,
  stockLocations,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { todayIsoDate } from "@/lib/dates";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { normalizeQuantity } from "./quantities";
import { cancelReception, createReception } from "./receptions";
import { ensureDefaultLocations, listInternalLocations } from "./locations";
import { insertStockMove } from "./moves";
import { getStockCounts, getStockOverview } from "./queries";
import { nextDocumentNumber } from "./sequences";
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

async function createOrder(
  ids: PurchasingTenant,
  lines: readonly { articleId: string; qty: string; unitPriceXof: number }[],
): Promise<string> {
  const created = await createPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      supplierId: ids.supplierId,
      expectedReceiptDate: "",
      externalReference: "",
      notes: "",
      lines,
    },
  });
  return created.id;
}

async function confirmOrder(ids: PurchasingTenant, orderId: string): Promise<void> {
  await transitionPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    action: "request",
  });
  await transitionPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    action: "confirm",
  });
}

async function orderLineIds(ids: PurchasingTenant, orderId: string): Promise<string[]> {
  const lines = await db
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(
      and(eq(purchaseOrderLines.tenantId, ids.tenantId), eq(purchaseOrderLines.orderId, orderId)),
    )
    .orderBy(asc(purchaseOrderLines.lineNumber));
  return lines.map((line) => line.id);
}

async function receive(ids: PurchasingTenant, orderId: string, quantities: readonly string[]) {
  const lineIds = await orderLineIds(ids, orderId);
  const locations = await listInternalLocations(db, ids.tenantId);
  const location = locations[0];
  if (!location) {
    throw new Error("Aucun emplacement interne.");
  }
  return createReception(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: location.id,
    receivedDate: todayIsoDate(),
    notes: null,
    lines: lineIds.map((orderLineId, index) => ({
      orderLineId,
      qty: quantities[index] ?? null,
    })),
  });
}

async function levelOf(ids: PurchasingTenant, articleId: string): Promise<string | null> {
  const [row] = await db
    .select({ quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, articleId)));
  return row ? normalizeQuantity(row.quantity) : null;
}

describe("STK-001 — emplacements par défaut et niveaux internes", () => {
  it("crée MAG, FOURN et CLIENT une seule fois, par tenant", async () => {
    const ids = await seedPurchasingTenant(db, "stk001-locations");

    const first = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
    const second = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
    expect(second).toEqual(first);

    const locations = await db
      .select({
        code: stockLocations.code,
        type: stockLocations.type,
        active: stockLocations.active,
      })
      .from(stockLocations)
      .where(eq(stockLocations.tenantId, ids.tenantId))
      .orderBy(asc(stockLocations.code));
    expect(locations).toEqual([
      { code: "CLIENT", type: "customer", active: true },
      { code: "FOURN", type: "supplier", active: true },
      { code: "MAG", type: "internal", active: true },
    ]);

    const internals = await listInternalLocations(db, ids.tenantId);
    expect(internals.map((location) => location.code)).toEqual(["MAG"]);
  });

  it("augmente le niveau MAG à la réception, ignore les services et le FOURN virtuel", async () => {
    const ids = await seedPurchasingTenant(db, "stk001-levels");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "4", unitPriceXof: 1000 },
      { articleId: ids.serviceId, qty: "2", unitPriceXof: 50000 },
    ]);
    await confirmOrder(ids, orderId);

    const lineIds = await orderLineIds(ids, orderId);
    const locations = await listInternalLocations(db, ids.tenantId);
    const received = await createReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      locationId: locations[0]!.id,
      receivedDate: todayIsoDate(),
      notes: null,
      lines: [{ orderLineId: lineIds[0]!, qty: "4" }],
    });

    expect(await levelOf(ids, ids.productId)).toBe("4");
    expect(await levelOf(ids, ids.serviceId)).toBeNull();

    const moveLines = await db
      .select({ articleId: stockMoveLines.articleId, qty: stockMoveLines.qty })
      .from(stockMoveLines)
      .where(eq(stockMoveLines.tenantId, ids.tenantId));
    expect(moveLines).toHaveLength(1);
    expect(moveLines[0]?.articleId).toBe(ids.productId);
    expect(normalizeQuantity(moveLines[0]!.qty)).toBe("4");

    const overview = await getStockOverview(db, ids.tenantId);
    expect(overview.levels.every((level) => level.locationCode === "MAG")).toBe(true);
    expect(overview.levels.map((level) => level.articleCode)).toEqual(["ART001"]);
    expect(overview.levels[0]?.quantity).toBe("4");
    expect(overview.moves).toHaveLength(1);
    expect(overview.moves[0]?.number).toBe(received.moveNumber);

    const counts = await getStockCounts(db, ids.tenantId);
    expect(counts).toEqual({ stockedArticles: 1, moves: 1 });
  });

  it("diminue le niveau à l'annulation sans jamais le rendre négatif", async () => {
    const ids = await seedPurchasingTenant(db, "stk001-cancel");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "3", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const reception = await receive(ids, orderId, ["3"]);
    expect(await levelOf(ids, ids.productId)).toBe("3");

    await cancelReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      receptionId: reception.receptionId,
    });
    expect(await levelOf(ids, ids.productId)).toBe("0");

    const [level] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(eq(stockLevels.tenantId, ids.tenantId));
    expect(level).toBeDefined();
  });

  it("sépare les niveaux de deux tenants", async () => {
    const first = await seedPurchasingTenant(db, "stk001-tenant-a");
    const second = await seedPurchasingTenant(db, "stk001-tenant-b");

    const firstOrder = await createOrder(first, [
      { articleId: first.productId, qty: "2", unitPriceXof: 1000 },
    ]);
    const secondOrder = await createOrder(second, [
      { articleId: second.productId, qty: "7", unitPriceXof: 1000 },
    ]);
    await confirmOrder(first, firstOrder);
    await confirmOrder(second, secondOrder);
    await receive(first, firstOrder, ["2"]);
    await receive(second, secondOrder, ["7"]);

    expect(await levelOf(first, first.productId)).toBe("2");
    expect(await levelOf(second, second.productId)).toBe("7");

    const firstOverview = await getStockOverview(db, first.tenantId);
    const secondOverview = await getStockOverview(db, second.tenantId);
    expect(firstOverview.levels.map((level) => level.quantity)).toEqual(["2"]);
    expect(secondOverview.levels.map((level) => level.quantity)).toEqual(["7"]);
  });
});

describe("STK-002 — journal des mouvements immuable", () => {
  it("écrit un mouvement d'entrée puis un mouvement inverse relié, sans toucher à l'original", async () => {
    const ids = await seedPurchasingTenant(db, "stk002-cancel");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "2.5", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const reception = await receive(ids, orderId, ["2.5"]);

    const [original] = await db
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ids.tenantId), eq(stockMoves.type, "incoming")));
    if (!original) {
      throw new Error("Mouvement d'entrée absent.");
    }
    const originalLines = await db
      .select()
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, original.id));

    const cancelled = await cancelReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      receptionId: reception.receptionId,
    });

    const [afterOriginal] = await db
      .select()
      .from(stockMoves)
      .where(eq(stockMoves.id, original.id));
    const afterOriginalLines = await db
      .select()
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, original.id));
    expect(afterOriginal).toEqual(original);
    expect(afterOriginalLines).toEqual(originalLines);

    const moves = await db
      .select()
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, ids.tenantId))
      .orderBy(asc(stockMoves.createdAt));
    expect(moves).toHaveLength(2);
    const reversal = moves.find((move) => move.cancelsMoveId === original.id);
    expect(reversal).toBeDefined();
    expect(reversal?.type).toBe("outgoing");
    expect(reversal?.number).toBe(cancelled.moveNumber);
    expect(reversal?.number).not.toBe(original.number);
    expect(reversal?.fromLocationId).toBe(original.toLocationId);
    expect(reversal?.toLocationId).toBe(original.fromLocationId);

    const reversalLines = await db
      .select({ articleId: stockMoveLines.articleId, qty: stockMoveLines.qty })
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, reversal!.id));
    expect(reversalLines).toHaveLength(1);
    expect(reversalLines[0]?.articleId).toBe(originalLines[0]?.articleId);
    expect(normalizeQuantity(reversalLines[0]!.qty)).toBe("2.5");
  });

  it("refuse un mouvement de service et un mouvement d'un autre tenant", async () => {
    const ids = await seedPurchasingTenant(db, "stk002-refusals");
    const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));

    await expect(
      db.transaction((tx) =>
        insertStockMove(tx, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          type: "incoming",
          fromLocationId: defaults.supplierId,
          toLocationId: defaults.internalId,
          realDate: todayIsoDate(),
          notes: null,
          lines: [{ articleId: ids.serviceId, qty: "1" }],
        }),
      ),
    ).rejects.toBeInstanceOf(StockError);

    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "1", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const reception = await receive(ids, orderId, ["1"]);
    const other = await seedPurchasingTenant(db, "stk002-other");

    await expect(
      cancelReception(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        receptionId: reception.receptionId,
      }),
    ).rejects.toThrow(/introuvable/);

    const overview = await getStockOverview(db, other.tenantId);
    expect(overview.moves).toHaveLength(0);
    expect(overview.levels).toHaveLength(0);
  });

  it("ne consomme pas de numéro MVT si la transaction échoue", async () => {
    const ids = await seedPurchasingTenant(db, "stk002-sequence");

    await expect(
      db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, {
          tenantId: ids.tenantId,
          scope: "stock_move",
        });
        expect(number).toMatch(/^MVT-\d{4}-0001$/);
        throw new Error("échec simulé après numérotation");
      }),
    ).rejects.toThrow("échec simulé");

    const number = await db.transaction((tx) =>
      nextDocumentNumber(tx, { tenantId: ids.tenantId, scope: "stock_move" }),
    );
    expect(number).toMatch(/^MVT-\d{4}-0001$/);
  });
});

describe("TEN — isolation du stock", () => {
  it("ne lit jamais les niveaux ni les mouvements d'un autre tenant", async () => {
    const first = await seedPurchasingTenant(db, "stock-ten-a");
    const second = await seedPurchasingTenant(db, "stock-ten-b");

    const orderId = await createOrder(first, [
      { articleId: first.productId, qty: "2", unitPriceXof: 1000 },
    ]);
    await confirmOrder(first, orderId);
    await receive(first, orderId, ["2"]);

    const [foreignLevel] = await db
      .select({ value: count() })
      .from(stockLevels)
      .where(eq(stockLevels.tenantId, second.tenantId));
    const [foreignMoves] = await db
      .select({ value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, second.tenantId));
    expect(foreignLevel?.value).toBe(0);
    expect(foreignMoves?.value).toBe(0);

    const ownArticles = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.tenantId, first.tenantId), eq(articles.code, "ART001")));
    expect(ownArticles).toHaveLength(1);
  });
});
