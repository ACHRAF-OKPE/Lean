import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  purchaseOrderLines,
  stockLevels,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { todayIsoDate } from "@/lib/dates";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { createReception } from "./receptions";
import { createStockLocation, ensureDefaultLocations, type DefaultLocations } from "./locations";
import { createAdjustment, cancelStockMove, createTransfer } from "./operations";
import { normalizeQuantity } from "./quantities";
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

interface Fixture {
  readonly defaults: DefaultLocations;
  readonly secondId: string;
}

async function fixture(ids: PurchasingTenant): Promise<Fixture> {
  const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
  const created = await createStockLocation(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: { code: "MAG2", name: "Entrepôt Nord" },
  });
  return { defaults, secondId: created.id };
}

async function levelAt(
  ids: PurchasingTenant,
  locationId: string,
  articleId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, ids.tenantId),
        eq(stockLevels.locationId, locationId),
        eq(stockLevels.articleId, articleId),
      ),
    );
  return row ? normalizeQuantity(row.quantity) : null;
}

async function seedStock(ids: PurchasingTenant, locationId: string, qty: string): Promise<void> {
  await createAdjustment(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    locationId,
    direction: "in",
    reason: "Stock initial",
    realDate: todayIsoDate(),
    lines: [{ articleId: ids.productId, qty }],
  });
}

describe("STK-007 — transfert entre deux magasins", () => {
  it("déplace le stock des deux côtés et écrit le mouvement et l'audit", async () => {
    const ids = await seedPurchasingTenant(db, "stk007-transfer");
    const { defaults, secondId } = await fixture(ids);
    await seedStock(ids, defaults.internalId, "10");

    const transfer = await createTransfer(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      fromLocationId: defaults.internalId,
      toLocationId: secondId,
      realDate: todayIsoDate(),
      notes: "Réapprovisionnement du point de vente",
      lines: [{ articleId: ids.productId, qty: "3" }],
    });

    expect(transfer.number).toMatch(/^MVT-\d{4}-\d{4}$/);
    expect(await levelAt(ids, defaults.internalId, ids.productId)).toBe("7");
    expect(await levelAt(ids, secondId, ids.productId)).toBe("3");

    const [move] = await db
      .select({ type: stockMoves.type, fromLocationId: stockMoves.fromLocationId })
      .from(stockMoves)
      .where(eq(stockMoves.id, transfer.moveId));
    expect(move?.type).toBe("transfer");
    expect(move?.fromLocationId).toBe(defaults.internalId);

    const [audit] = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityId, transfer.moveId)),
      );
    expect(audit?.action).toBe("stock.transfer.create");
  });

  it("refuse un transfert vers le même magasin, sans stock ou avec un service", async () => {
    const ids = await seedPurchasingTenant(db, "stk007-refusals");
    const { defaults, secondId } = await fixture(ids);

    await expect(
      createTransfer(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fromLocationId: defaults.internalId,
        toLocationId: defaults.internalId,
        realDate: todayIsoDate(),
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1" }],
      }),
    ).rejects.toThrow(/doivent différer/);

    await expect(
      createTransfer(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fromLocationId: defaults.internalId,
        toLocationId: secondId,
        realDate: todayIsoDate(),
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1" }],
      }),
    ).rejects.toThrow(/Stock insuffisant/);

    await expect(
      createTransfer(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fromLocationId: defaults.internalId,
        toLocationId: secondId,
        realDate: todayIsoDate(),
        notes: "",
        lines: [{ articleId: ids.serviceId, qty: "1" }],
      }),
    ).rejects.toThrow(StockError);

    const [moves] = await db
      .select({ value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, ids.tenantId));
    expect(moves?.value).toBe(0);
  });
});

describe("STK-008 — ajustement d'inventaire via l'emplacement virtuel", () => {
  it("crée un excédent puis un manquant sans suivre le niveau de l'emplacement d'inventaire", async () => {
    const ids = await seedPurchasingTenant(db, "stk008-adjust");
    const { defaults } = await fixture(ids);

    await seedStock(ids, defaults.internalId, "5");
    expect(await levelAt(ids, defaults.internalId, ids.productId)).toBe("5");
    expect(await levelAt(ids, defaults.inventoryId, ids.productId)).toBeNull();

    const [incoming] = await db
      .select({ notes: stockMoves.notes, type: stockMoves.type })
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.tenantId, ids.tenantId),
          eq(stockMoves.toLocationId, defaults.internalId),
        ),
      );
    expect(incoming?.type).toBe("incoming");
    expect(incoming?.notes).toBe("Ajustement d'inventaire : Stock initial");

    await createAdjustment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      locationId: defaults.internalId,
      direction: "out",
      reason: "Casse constatée",
      realDate: todayIsoDate(),
      lines: [{ articleId: ids.productId, qty: "2" }],
    });
    expect(await levelAt(ids, defaults.internalId, ids.productId)).toBe("3");
    expect(await levelAt(ids, defaults.inventoryId, ids.productId)).toBeNull();
  });

  it("exige un motif par défaut et refuse de descendre sous zéro", async () => {
    const ids = await seedPurchasingTenant(db, "stk008-motif");
    const { defaults } = await fixture(ids);

    await expect(
      createAdjustment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        locationId: defaults.internalId,
        direction: "in",
        reason: "",
        realDate: todayIsoDate(),
        lines: [{ articleId: ids.productId, qty: "1" }],
      }),
    ).rejects.toThrow(/obligatoire/);

    await seedStock(ids, defaults.internalId, "1");
    await expect(
      createAdjustment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        locationId: defaults.internalId,
        direction: "out",
        reason: "Manquant",
        realDate: todayIsoDate(),
        lines: [{ articleId: ids.productId, qty: "2" }],
      }),
    ).rejects.toThrow(/Stock insuffisant/);
  });
});

describe("STK-002 — annulation par mouvement inverse (opérations)", () => {
  it("annule un transfert en écrivant le mouvement inverse", async () => {
    const ids = await seedPurchasingTenant(db, "stk002-cancel-transfer");
    const { defaults, secondId } = await fixture(ids);
    await seedStock(ids, defaults.internalId, "10");
    const transfer = await createTransfer(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      fromLocationId: defaults.internalId,
      toLocationId: secondId,
      realDate: todayIsoDate(),
      notes: "",
      lines: [{ articleId: ids.productId, qty: "4" }],
    });

    const reversal = await cancelStockMove(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      moveId: transfer.moveId,
    });

    expect(await levelAt(ids, defaults.internalId, ids.productId)).toBe("10");
    expect(await levelAt(ids, secondId, ids.productId)).toBe("0");
    const [move] = await db
      .select({
        cancelsMoveId: stockMoves.cancelsMoveId,
        fromLocationId: stockMoves.fromLocationId,
      })
      .from(stockMoves)
      .where(eq(stockMoves.id, reversal.moveId));
    expect(move?.cancelsMoveId).toBe(transfer.moveId);
    expect(move?.fromLocationId).toBe(secondId);

    await expect(
      cancelStockMove(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        moveId: transfer.moveId,
      }),
    ).rejects.toThrow(/déjà annulé/);

    await expect(
      cancelStockMove(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        moveId: reversal.moveId,
      }),
    ).rejects.toThrow(/mouvement d'origine/);
  });

  it("refuse d'annuler un mouvement rattaché à une réception", async () => {
    const ids = await seedPurchasingTenant(db, "stk002-cancel-reception");
    const { defaults } = await fixture(ids);

    const created = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "2", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: created.id,
      action: "request",
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: created.id,
      action: "confirm",
    });
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, created.id))
      .orderBy(asc(purchaseOrderLines.lineNumber));
    await createReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: created.id,
      locationId: defaults.internalId,
      receivedDate: todayIsoDate(),
      notes: null,
      lines: [{ orderLineId: line!.id, qty: "2" }],
    });

    const [incoming] = await db
      .select({ id: stockMoves.id })
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ids.tenantId), eq(stockMoves.type, "incoming")));
    expect(incoming).toBeDefined();

    await expect(
      cancelStockMove(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        moveId: incoming!.id,
      }),
    ).rejects.toThrow(/document source/);

    // Le mouvement d'origine reste intact et la ligne de mouvement inchangée.
    const lines = await db
      .select({ value: count() })
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, incoming!.id));
    expect(lines[0]?.value).toBe(1);
  });
});
