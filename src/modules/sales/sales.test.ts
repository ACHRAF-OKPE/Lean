import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  deliveries,
  invoices,
  salesOrders,
  stockLevels,
  stockLocations,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant, type SalesTenant } from "@/test/sales";
import { todayIsoDate } from "@/lib/dates";
import { SalesError } from "./errors";
import { createInvoice, validateInvoice } from "./invoices";
import { getSalesOrder, transitionSalesOrder } from "./queries";
import { createSalesOrder } from "./queries";
import { cancelDelivery, createDelivery } from "./deliveries";
import { listInternalLocations } from "@/modules/stock/locations";
import { getStockOverview } from "@/modules/stock/queries";
import { normalizeQuantity } from "@/modules/stock/quantities";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

function draftData(
  ids: SalesTenant,
  lines: readonly { articleId: string; qty: unknown; unitPriceXof: unknown }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    customerId: ids.customerId,
    expectedDeliveryDate: "",
    externalReference: "",
    incoterm: "",
    notes: "",
    lines,
    ...overrides,
  };
}

async function createOrder(
  ids: SalesTenant,
  lines: readonly { articleId: string; qty: unknown; unitPriceXof: unknown }[],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const created = await createSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: draftData(ids, lines, overrides),
  });
  return created.id;
}

async function confirmOrder(ids: SalesTenant, orderId: string): Promise<string> {
  const result = await transitionSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    action: "confirm",
  });
  if (!result.number) {
    throw new Error("Numéro de commande attendu.");
  }
  return result.number;
}

async function orderLines(ids: SalesTenant, orderId: string) {
  const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
  if (!detail) {
    throw new Error("Commande introuvable.");
  }
  return detail.lines;
}

async function deliver(
  ids: SalesTenant,
  orderId: string,
  lines: readonly { orderLineId: string; qty: unknown }[],
  options: { deliveredDate?: string; locationId?: string; notes?: string } = {},
) {
  return createDelivery(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: options.locationId ?? ids.locationId,
    deliveredDate: options.deliveredDate ?? todayIsoDate(),
    notes: options.notes ?? null,
    lines,
  });
}

async function levelOf(ids: SalesTenant, articleId: string, locationId = ids.locationId) {
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

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("SAL-001 — éligibilité et totaux d'une commande client", () => {
  it("refuse un tiers sans rôle client, un client inactif et une commande vide", async () => {
    const ids = await seedSalesTenant(db, "sal001-eligibilite");
    const line = [{ articleId: ids.productId, qty: "1", unitPriceXof: 1500 }];

    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: { ...draftData(ids, line), customerId: ids.supplierId },
      }),
    ).rejects.toThrow(/rôle client/);

    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: { ...draftData(ids, line), customerId: ids.inactiveCustomerId },
      }),
    ).rejects.toThrow(/inactif/);

    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, []),
      }),
    ).rejects.toThrow(/au moins une ligne/);
  });

  it("refuse un article inactif, non vendable et les valeurs hors bornes", async () => {
    const ids = await seedSalesTenant(db, "sal001-articles");
    const attempt = (lines: { articleId: string; qty: unknown; unitPriceXof: unknown }[]) =>
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, lines),
      });

    await expect(
      attempt([{ articleId: ids.inactiveProductId, qty: "1", unitPriceXof: 1000 }]),
    ).rejects.toThrow(/inactif/);
    await expect(
      attempt([{ articleId: ids.notSellableId, qty: "1", unitPriceXof: 1000 }]),
    ).rejects.toThrow(/vendable/);
    await expect(
      attempt([{ articleId: ids.productId, qty: "0", unitPriceXof: 1000 }]),
    ).rejects.toThrow(/strictement positive/);
    await expect(
      attempt([{ articleId: ids.productId, qty: "1", unitPriceXof: "12.5" }]),
    ).rejects.toThrow(/entier/);
    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }], {
          incoterm: "XYZ",
        }),
      }),
    ).rejects.toThrow(/Incoterm/);
    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }], {
          expectedDeliveryDate: "2026-02-30",
        }),
      }),
    ).rejects.toThrow(/Date de livraison prévue/);
    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }], {
          externalReference: "x".repeat(61),
        }),
      }),
    ).rejects.toThrow(/60 caractères/);
    await expect(
      createSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }], {
          notes: "x".repeat(1001),
        }),
      }),
    ).rejects.toThrow(/1000 caractères/);
  });

  it("crée un brouillon sans numéro avec total, incoterm normalisé et avertissement de prix", async () => {
    const ids = await seedSalesTenant(db, "sal001-creation");
    const expectedDate = addDays(todayIsoDate(), 10);
    const created = await createSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: draftData(
        ids,
        [
          { articleId: ids.productId, qty: "2", unitPriceXof: 1400 },
          { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
        ],
        {
          expectedDeliveryDate: expectedDate,
          externalReference: "  REF-CLI-01  ",
          incoterm: " fob ",
          notes: "  Livraison au port  ",
        },
      ),
    });

    expect(created.warnings).toHaveLength(1);
    expect(created.warnings[0]).toMatch(/prix de vente de la fiche/);

    const detail = await getSalesOrder(db, {
      tenantId: ids.tenantId,
      orderId: created.id,
    });
    if (!detail) {
      throw new Error("Commande créée introuvable.");
    }
    expect(detail.order.status).toBe("draft");
    expect(detail.order.number).toBeNull();
    expect(detail.order.incoterm).toBe("FOB");
    expect(detail.order.externalReference).toBe("REF-CLI-01");
    expect(detail.order.notes).toBe("Livraison au port");
    expect(detail.order.expectedDeliveryDate).toBe(expectedDate);
    expect(detail.order.exTaxTotal).toBe(77800);
    expect(detail.order.deliveryState).toBe("not_delivered");
    expect(detail.order.invoicingState).toBe("not_invoiced");
    expect(detail.lines.map((line) => line.remainingToDeliver)).toEqual(["2", "1"]);
    expect(detail.lines.map((line) => line.remainingToInvoice)).toEqual(["0", "1"]);

    const audits = await db
      .select({ action: auditEvents.action, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "sales.order.create")),
      );
    expect(audits).toHaveLength(1);
    expect((audits[0]?.details as { customerCode?: string }).customerCode).toBe("CUST001");
  });

  it("signale une même ligne article présente deux fois", async () => {
    const ids = await seedSalesTenant(db, "sal001-doublon");
    const created = await createSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: draftData(ids, [
        { articleId: ids.productId, qty: "1", unitPriceXof: 1500 },
        { articleId: ids.productId, qty: "2", unitPriceXof: 1500 },
      ]),
    });
    expect(created.warnings.some((warning) => warning.includes("plusieurs lignes"))).toBe(true);
    expect(created.warnings.some((warning) => warning.includes("prix de vente"))).toBe(false);
  });
});

describe("SAL-002 — cycle de vie de la commande client", () => {
  it("confirme, clôture et refuse les retours en arrière", async () => {
    const ids = await seedSalesTenant(db, "sal002-cycle");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "1", unitPriceXof: 1500 },
    ]);

    const number = await confirmOrder(ids, orderId);
    expect(number).toMatch(/^VTE-\d{4}-0001$/);

    const confirmed = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(confirmed?.order.status).toBe("confirmed");
    expect(confirmed?.order.number).toBe(number);

    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "confirm",
      }),
    ).rejects.toThrow(/Action impossible/);

    await transitionSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      action: "close",
    });
    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "cancel",
      }),
    ).rejects.toThrow(/Action impossible/);

    const cancelledId = await createOrder(ids, [
      { articleId: ids.productId, qty: "1", unitPriceXof: 1500 },
    ]);
    await transitionSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: cancelledId,
      action: "cancel",
    });
    const cancelled = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: cancelledId });
    expect(cancelled?.order.status).toBe("cancelled");
    expect(cancelled?.order.number).toBeNull();
    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: cancelledId,
        action: "confirm",
      }),
    ).rejects.toThrow(/Action impossible/);
  });

  it("refuse l'annulation après une livraison validée", async () => {
    const ids = await seedSalesTenant(db, "sal002-livraison");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "2", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);
    await deliver(ids, orderId, [{ orderLineId: line!.id, qty: "1" }]);

    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "cancel",
      }),
    ).rejects.toThrow(/livraison validée/);
  });

  it("refuse l'annulation après une facture validée", async () => {
    const ids = await seedSalesTenant(db, "sal002-facture");
    const orderId = await createOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);
    const invoice = await createInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      invoiceDate: todayIsoDate(),
      dueDate: addDays(todayIsoDate(), 30),
      notes: "",
      lines: [{ orderLineId: line!.id, qty: "1" }],
    });
    await validateInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
    });

    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "cancel",
      }),
    ).rejects.toThrow(/facture validée/);
  });
});

describe("SAL-003 — livraison, reliquat et sortie de stock", () => {
  it("exige une commande confirmée, une date non future et un emplacement interne", async () => {
    const ids = await seedSalesTenant(db, "sal003-gardes");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1500 },
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const [productLine, serviceLine] = await orderLines(ids, orderId);

    await expect(
      deliver(ids, orderId, [{ orderLineId: productLine!.id, qty: "1" }]),
    ).rejects.toThrow(/confirmée/);

    await confirmOrder(ids, orderId);

    await expect(
      deliver(ids, orderId, [{ orderLineId: productLine!.id, qty: "1" }], {
        deliveredDate: addDays(todayIsoDate(), 1),
      }),
    ).rejects.toThrow(/futur/);
    await expect(
      deliver(ids, orderId, [{ orderLineId: productLine!.id, qty: "1" }], {
        locationId: ids.supplierId,
      }),
    ).rejects.toThrow(/introuvable/);
    await expect(deliver(ids, orderId, [])).rejects.toThrow(/au moins une quantité/);
    await expect(
      deliver(ids, orderId, [{ orderLineId: serviceLine!.id, qty: "1" }]),
    ).rejects.toThrow(/service/);
    await expect(
      deliver(ids, orderId, [
        { orderLineId: productLine!.id, qty: "1" },
        { orderLineId: productLine!.id, qty: "1" },
      ]),
    ).rejects.toThrow(/deux fois/);
  });

  it("refuse tout dépassement du reliquat", async () => {
    const ids = await seedSalesTenant(db, "sal003-reliquat");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);

    await expect(deliver(ids, orderId, [{ orderLineId: line!.id, qty: "6" }])).rejects.toThrow(
      /reliquat de 5/,
    );

    await deliver(ids, orderId, [{ orderLineId: line!.id, qty: "2" }]);
    await expect(deliver(ids, orderId, [{ orderLineId: line!.id, qty: "4" }])).rejects.toThrow(
      /reliquat de 3/,
    );
  });

  it("livre partiellement puis totalement, écrit la sortie et met à jour les états", async () => {
    const ids = await seedSalesTenant(db, "sal003-livraison");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1500 },
      { articleId: ids.secondProductId, qty: "2", unitPriceXof: 700 },
    ]);
    await confirmOrder(ids, orderId);
    const [first, second] = await orderLines(ids, orderId);

    const partial = await deliver(ids, orderId, [{ orderLineId: first!.id, qty: "3" }]);
    expect(partial.number).toMatch(/^BL-\d{4}-0001$/);
    expect(await levelOf(ids, ids.productId)).toBe("97");

    let detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.order.deliveryState).toBe("partially_delivered");
    expect(detail?.lines[0]?.deliveredQty).toBe("3");
    expect(detail?.lines[0]?.deliveryState).toBe("partially_delivered");
    expect(detail?.lines[1]?.deliveryState).toBe("not_delivered");
    expect(detail?.deliveries[0]?.number).toBe(partial.number);
    expect(detail?.deliveries[0]?.locationCode).toBe("MAG");

    const [move] = await db
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ids.tenantId), eq(stockMoves.type, "outgoing")));
    expect(move).toMatchObject({
      fromLocationId: ids.locationId,
      toLocationId: ids.customerLocationId,
      partnerId: ids.customerId,
      salesOrderId: orderId,
    });
    const deliveryRows = await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, ids.tenantId), eq(deliveries.orderId, orderId)));
    expect(deliveryRows).toHaveLength(1);
    expect(move?.deliveryId).toBe(deliveryRows[0]?.id);
    const moveLines = await db
      .select({ qty: stockMoveLines.qty, salesOrderLineId: stockMoveLines.salesOrderLineId })
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, move!.id));
    expect(normalizeQuantity(moveLines[0]!.qty)).toBe("3");
    expect(moveLines[0]?.salesOrderLineId).toBe(first!.id);

    await deliver(ids, orderId, [
      { orderLineId: first!.id, qty: "2" },
      { orderLineId: second!.id, qty: "2" },
    ]);
    expect(await levelOf(ids, ids.productId)).toBe("95");
    expect(await levelOf(ids, ids.secondProductId)).toBe("38");

    detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.order.deliveryState).toBe("delivered");
    expect(detail?.lines.every((line) => line.deliveryState === "delivered")).toBe(true);
    expect(detail?.lines.map((line) => line.remainingToDeliver)).toEqual(["0", "0"]);
  });

  it("considère une commande de services comme livrée et refuse un stock insuffisant", async () => {
    const ids = await seedSalesTenant(db, "sal003-stock");
    const serviceOrder = await createOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const serviceDetail = await getSalesOrder(db, {
      tenantId: ids.tenantId,
      orderId: serviceOrder,
    });
    expect(serviceDetail?.order.deliveryState).toBe("delivered");

    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "150", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);

    await expect(deliver(ids, orderId, [{ orderLineId: line!.id, qty: "150" }])).rejects.toThrow(
      /Stock insuffisant/,
    );

    const [rows] = await db
      .select({ value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, ids.tenantId), eq(deliveries.orderId, orderId)));
    expect(rows?.value).toBe(0);
    const orderRow = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(orderRow?.lines[0]?.deliveredQty).toBe("0");
  });
});

describe("SAL-004 — annulation d'une livraison par mouvement inverse", () => {
  it("inverse le mouvement, le stock et les états sans modifier l'original", async () => {
    const ids = await seedSalesTenant(db, "sal004-annulation");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);
    const delivery = await deliver(ids, orderId, [{ orderLineId: line!.id, qty: "2" }]);
    expect(await levelOf(ids, ids.productId)).toBe("98");

    const [original] = await db
      .select()
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.tenantId, ids.tenantId),
          eq(stockMoves.type, "outgoing"),
          eq(stockMoves.deliveryId, delivery.deliveryId),
        ),
      );
    if (!original) {
      throw new Error("Mouvement de sortie absent.");
    }
    const originalLines = await db
      .select()
      .from(stockMoveLines)
      .where(eq(stockMoveLines.moveId, original.id));

    const cancelled = await cancelDelivery(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      deliveryId: delivery.deliveryId,
    });
    expect(cancelled.number).toBe(delivery.number);
    expect(cancelled.moveNumber).toMatch(/^MVT-\d{4}-\d{4}$/);
    expect(cancelled.moveNumber).not.toBe(original.number);

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

    expect(await levelOf(ids, ids.productId)).toBe("100");

    const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.order.deliveryState).toBe("not_delivered");
    expect(detail?.lines[0]?.deliveredQty).toBe("0");
    expect(detail?.lines[0]?.deliveryState).toBe("not_delivered");
    expect(detail?.deliveries[0]?.status).toBe("cancelled");

    const reversal = await db
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ids.tenantId), eq(stockMoves.cancelsMoveId, original.id)));
    expect(reversal).toHaveLength(1);
    expect(reversal[0]).toMatchObject({
      type: "incoming",
      fromLocationId: ids.customerLocationId,
      toLocationId: ids.locationId,
      deliveryId: delivery.deliveryId,
    });
    expect(reversal[0]?.number).toBe(cancelled.moveNumber);
  });

  it("refuse l'annulation si une quantité facturée dépasserait la livraison restante", async () => {
    const ids = await seedSalesTenant(db, "sal004-facturation");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "10", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);
    const delivery = await deliver(ids, orderId, [{ orderLineId: line!.id, qty: "10" }]);
    const invoice = await createInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      invoiceDate: todayIsoDate(),
      dueDate: addDays(todayIsoDate(), 30),
      notes: "",
      lines: [{ orderLineId: line!.id, qty: "10" }],
    });
    await validateInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
    });

    await expect(
      cancelDelivery(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        deliveryId: delivery.deliveryId,
      }),
    ).rejects.toThrow(/annulation refusée/);
    expect(await levelOf(ids, ids.productId)).toBe("90");

    const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.deliveries[0]?.status).toBe("validated");
  });

  it("ne lit ni n'annule les livraisons d'un autre tenant", async () => {
    const first = await seedSalesTenant(db, "sal004-tenant-a");
    const second = await seedSalesTenant(db, "sal004-tenant-b");
    const orderId = await createOrder(first, [
      { articleId: first.productId, qty: "2", unitPriceXof: 1500 },
    ]);
    await confirmOrder(first, orderId);
    const [line] = await orderLines(first, orderId);
    const delivery = await deliver(first, orderId, [{ orderLineId: line!.id, qty: "1" }]);

    expect(await getSalesOrder(db, { tenantId: second.tenantId, orderId })).toBeNull();
    await expect(
      cancelDelivery(db, {
        tenantId: second.tenantId,
        actorUserId: second.userId,
        deliveryId: delivery.deliveryId,
      }),
    ).rejects.toThrow(/introuvable/);
    expect(await levelOf(first, first.productId)).toBe("99");
  });
});

describe("STK-003 — emplacement client virtuel", () => {
  it("crée CLIENT hors stock interne et ne suit pas son niveau", async () => {
    const ids = await seedSalesTenant(db, "stk003-client");
    const [customerLocation] = await db
      .select({ type: stockLocations.type })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.tenantId, ids.tenantId),
          eq(stockLocations.id, ids.customerLocationId),
        ),
      );
    expect(customerLocation?.type).toBe("customer");

    const internals = await listInternalLocations(db, ids.tenantId);
    expect(internals.map((location) => location.code)).toEqual(["MAG"]);

    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "1", unitPriceXof: 1500 },
    ]);
    await confirmOrder(ids, orderId);
    const [line] = await orderLines(ids, orderId);
    await deliver(ids, orderId, [{ orderLineId: line!.id, qty: "1" }]);

    const [customerLevels] = await db
      .select({ value: count() })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.tenantId, ids.tenantId),
          eq(stockLevels.locationId, ids.customerLocationId),
        ),
      );
    expect(customerLevels?.value).toBe(0);
    expect(await levelOf(ids, ids.productId)).toBe("99");

    const overview = await getStockOverview(db, ids.tenantId);
    expect(overview.levels.every((level) => level.locationCode === "MAG")).toBe(true);
  });
});

describe("SAL-007 — séquences VTE, BL, FAC", () => {
  it("numérote par tenant et par flux, les brouillons restant sans numéro", async () => {
    const first = await seedSalesTenant(db, "sal007-premier");
    const second = await seedSalesTenant(db, "sal007-second");

    const firstOrder = await createOrder(first, [
      { articleId: first.productId, qty: "2", unitPriceXof: 1500 },
    ]);
    const secondOrder = await createOrder(first, [
      { articleId: first.productId, qty: "1", unitPriceXof: 1500 },
    ]);
    const foreignOrder = await createOrder(second, [
      { articleId: second.productId, qty: "1", unitPriceXof: 1500 },
    ]);

    expect(await confirmOrder(first, firstOrder)).toMatch(/^VTE-\d{4}-0001$/);
    expect(await confirmOrder(first, secondOrder)).toMatch(/^VTE-\d{4}-0002$/);
    expect(await confirmOrder(second, foreignOrder)).toMatch(/^VTE-\d{4}-0001$/);

    const [firstLine] = await orderLines(first, firstOrder);
    const [secondLine] = await orderLines(first, secondOrder);
    expect(
      (await deliver(first, firstOrder, [{ orderLineId: firstLine!.id, qty: "1" }])).number,
    ).toMatch(/^BL-\d{4}-0001$/);
    expect(
      (await deliver(first, secondOrder, [{ orderLineId: secondLine!.id, qty: "1" }])).number,
    ).toMatch(/^BL-\d{4}-0002$/);

    const draft = await createInvoice(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      orderId: firstOrder,
      invoiceDate: todayIsoDate(),
      dueDate: addDays(todayIsoDate(), 30),
      notes: "",
      lines: [{ orderLineId: firstLine!.id, qty: "1" }],
    });
    const [draftInvoice] = await db
      .select({ number: invoices.number, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, draft.invoiceId));
    expect(draftInvoice).toEqual({ number: null, status: "draft" });

    const validated = await validateInvoice(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      invoiceId: draft.invoiceId,
    });
    expect(validated.number).toMatch(/^FAC-\d{4}-0001$/);
  });
});

describe("TEN — isolation des ventes", () => {
  it("ne rend visibles ni les commandes ni les factures d'un autre tenant", async () => {
    const first = await seedSalesTenant(db, "ventes-ten-a");
    const second = await seedSalesTenant(db, "ventes-ten-b");
    const orderId = await createOrder(first, [
      { articleId: first.productId, qty: "1", unitPriceXof: 1500 },
    ]);

    expect(await getSalesOrder(db, { tenantId: second.tenantId, orderId })).toBeNull();
    const [foreign] = await db
      .select({ value: count() })
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, second.tenantId));
    expect(foreign?.value).toBe(0);
  });
});

describe("Erreurs métier", () => {
  it("refuse une commande introuvable avec SalesError", async () => {
    const ids = await seedSalesTenant(db, "ventes-erreurs");
    await expect(
      transitionSalesOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: "00000000-0000-4000-8000-000000000000",
        action: "confirm",
      }),
    ).rejects.toBeInstanceOf(SalesError);
  });
});
