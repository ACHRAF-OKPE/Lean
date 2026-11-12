import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  memberships,
  partnerBankAccounts,
  partners,
  purchaseOrders,
  receptions,
  stockLevels,
  stockLocations,
  stockMoves,
  users,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { todayIsoDate } from "@/lib/dates";
import { PurchaseError } from "./errors";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  getPurchaseOrderPaymentDetails,
  recordSupplierInvoiceAndMatch,
  resolveMatchingDispute,
  transitionPurchaseOrder,
} from "./queries";
import { cancelReception, createReception } from "@/modules/stock/receptions";
import { ensureDefaultLocations, listInternalLocations } from "@/modules/stock/locations";
import { normalizeQuantity } from "@/modules/stock/quantities";
import { savePartnerBankAccount } from "@/modules/catalog/partner-bank-account-queries";
import { validatePartnerBankAccount } from "@/modules/catalog/partner-bank-account";
import { savePurchaseSettings } from "./settings";

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
  ids: PurchasingTenant,
  lines: readonly { articleId: string; qty: unknown; unitPriceXof: unknown }[],
) {
  return {
    supplierId: ids.supplierId,
    expectedReceiptDate: "",
    externalReference: "",
    notes: "",
    lines,
  };
}

async function createOrder(
  ids: PurchasingTenant,
  lines: readonly { articleId: string; qty: unknown; unitPriceXof: unknown }[],
): Promise<string> {
  const created = await createPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: draftData(ids, lines),
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

async function internalLocation(ids: PurchasingTenant): Promise<string> {
  const locations = await listInternalLocations(db, ids.tenantId);
  const location = locations[0];
  if (!location) {
    throw new Error("Aucun emplacement interne.");
  }
  return location.id;
}

async function receive(
  ids: PurchasingTenant,
  orderId: string,
  lines: readonly { orderLineId: string; qty: unknown }[],
  options: { receivedDate?: string; locationId?: string; notes?: string } = {},
) {
  return createReception(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: options.locationId ?? (await internalLocation(ids)),
    receivedDate: options.receivedDate ?? todayIsoDate(),
    notes: options.notes ?? null,
    lines,
  });
}

async function firstLineId(orderId: string, tenantId: string): Promise<string> {
  const detail = await getPurchaseOrder(db, { tenantId, orderId });
  const line = detail?.lines[0];
  if (!line) {
    throw new Error("Ligne de commande introuvable.");
  }
  return line.id;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("PUR-001 — éligibilité et totaux d'une commande", () => {
  it("refuse fournisseur inactif, tiers sans rôle fournisseur, commande vide et lignes invalides", async () => {
    const ids = await seedPurchasingTenant(db, "pur001");
    const line = [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }];

    await expect(
      createPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: { ...draftData(ids, line), supplierId: ids.inactiveSupplierId },
      }),
    ).rejects.toThrow(/inactif/);

    await expect(
      createPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: { ...draftData(ids, line), supplierId: ids.customerId },
      }),
    ).rejects.toThrow(/rôle fournisseur/);

    await expect(
      createPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, []),
      }),
    ).rejects.toThrow(/au moins une ligne/);

    for (const badLine of [
      { articleId: ids.inactiveProductId, qty: "1", unitPriceXof: 1000 },
      { articleId: ids.notPurchasableId, qty: "1", unitPriceXof: 1000 },
      { articleId: ids.productId, qty: "0", unitPriceXof: 1000 },
      { articleId: ids.productId, qty: "1.1234567", unitPriceXof: 1000 },
      { articleId: ids.productId, qty: "1", unitPriceXof: "1000.5" },
      { articleId: ids.productId, qty: "1000000", unitPriceXof: 2000000000 },
    ]) {
      await expect(
        createPurchaseOrder(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          data: draftData(ids, [badLine]),
        }),
      ).rejects.toThrow(PurchaseError);
    }

    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId: ids.tenantId });
    expect(detail).toBeNull();
  });

  it("arrondit chaque ligne en HALF_UP et somme le total", async () => {
    const ids = await seedPurchasingTenant(db, "pur001-total");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "3", unitPriceXof: 1000 },
      { articleId: ids.secondProductId, qty: "1.5", unitPriceXof: 999 },
    ]);

    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.lines.map((line) => line.lineTotalXof)).toEqual([3000, 1499]);
    expect(detail?.order.exTaxTotal).toBe(4499);
    expect(detail?.order.status).toBe("draft");
    expect(detail?.order.number).toBeNull();
  });

  it("répute reçue une commande composée uniquement de services", async () => {
    const ids = await seedPurchasingTenant(db, "pur001-service");
    const orderId = await createOrder(ids, [
      { articleId: ids.serviceId, qty: "2", unitPriceXof: 50000 },
    ]);
    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.order.receiptState).toBe("received");

    await confirmOrder(ids, orderId);
    const line = detail?.lines[0];
    if (!line) {
      throw new Error("Ligne de service absente.");
    }
    await expect(receive(ids, orderId, [{ orderLineId: line.id, qty: "1" }])).rejects.toThrow(
      /service/,
    );
  });
});

describe("PUR-002 — cycle de vie et audit", () => {
  it("enchaîne brouillon, demandée, confirmée, clôturée et refuse les doubles transitions", async () => {
    const ids = await seedPurchasingTenant(db, "pur002");
    const orderId = await createOrder(ids, [
      { articleId: ids.serviceId, qty: "2", unitPriceXof: 1000 },
    ]);

    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      action: "request",
    });
    const confirmed = await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      action: "confirm",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.number).toMatch(/^CMD-\d{4}-0001$/);

    await expect(
      transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "confirm",
      }),
    ).rejects.toThrow(/Action impossible/);

    const [confirmAudit] = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "purchase.order.confirm"),
          eq(auditEvents.entityId, orderId),
        ),
      );
    expect(confirmAudit?.details).toMatchObject({ from: "requested", to: "confirmed" });

    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      action: "close",
    });
    const closed = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(closed?.order.status).toBe("closed");

    await expect(
      transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "cancel",
      }),
    ).rejects.toThrow(/Action impossible/);
  });

  it("annule un brouillon sans numéro et refuse ensuite toute demande", async () => {
    const ids = await seedPurchasingTenant(db, "pur002-cancel");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "1", unitPriceXof: 1000 },
    ]);
    const cancelled = await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId,
      action: "cancel",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.number).toBeNull();

    await expect(
      transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "request",
      }),
    ).rejects.toThrow(/Action impossible/);
  });

  it("refuse l'annulation d'une commande ayant une réception validée", async () => {
    const ids = await seedPurchasingTenant(db, "pur002-reception");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "2", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    await receive(ids, orderId, [
      { orderLineId: await firstLineId(orderId, ids.tenantId), qty: "1" },
    ]);

    await expect(
      transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId,
        action: "cancel",
      }),
    ).rejects.toThrow(/réception validée/);
  });
});

describe("PUR-003 — états de réception dérivés", () => {
  it("passe d'une ligne partielle à reçue, puis à la commande reçue", async () => {
    const ids = await seedPurchasingTenant(db, "pur003");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1000 },
      { articleId: ids.secondProductId, qty: "2", unitPriceXof: 450 },
    ]);
    await confirmOrder(ids, orderId);
    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    const [first, second] = detail?.lines ?? [];
    if (!first || !second) {
      throw new Error("Lignes absentes.");
    }

    await receive(ids, orderId, [{ orderLineId: first.id, qty: "2" }]);
    let state = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(state?.lines[0]?.receiptState).toBe("partially_received");
    expect(state?.lines[0]?.receivedQty).toBe("2");
    expect(state?.lines[0]?.remainingQty).toBe("3");
    expect(state?.order.receiptState).toBe("partially_received");

    await receive(ids, orderId, [{ orderLineId: first.id, qty: "3" }]);
    state = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(state?.lines[0]?.receiptState).toBe("received");
    expect(state?.order.receiptState).toBe("partially_received");

    await receive(ids, orderId, [{ orderLineId: second.id, qty: "2" }]);
    state = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(state?.order.receiptState).toBe("received");

    await expect(receive(ids, orderId, [{ orderLineId: first.id, qty: "1" }])).rejects.toThrow(
      /déjà intégralement reçue/,
    );
  });

  it("accepte une sur-réception sur une ligne encore partielle, puis la refuse", async () => {
    const ids = await seedPurchasingTenant(db, "pur003-surplus");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const lineId = await firstLineId(orderId, ids.tenantId);

    await receive(ids, orderId, [{ orderLineId: lineId, qty: "2" }]);
    const surplus = await receive(ids, orderId, [{ orderLineId: lineId, qty: "4" }]);
    expect(surplus.warnings.join(" ")).toMatch(/sur-réception de 1/);

    const state = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(state?.lines[0]?.receivedQty).toBe("6");
    expect(state?.lines[0]?.receiptState).toBe("received");

    await expect(receive(ids, orderId, [{ orderLineId: lineId, qty: "1" }])).rejects.toThrow(
      /déjà intégralement reçue/,
    );
  });
});

describe("PUR-004 — réception transactionnelle et annulation", () => {
  it("refuse une date future, une destination fournisseur et une réception vide", async () => {
    const ids = await seedPurchasingTenant(db, "pur004-validation");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const lineId = await firstLineId(orderId, ids.tenantId);

    await expect(
      receive(ids, orderId, [{ orderLineId: lineId, qty: "1" }], {
        receivedDate: addDays(todayIsoDate(), 1),
      }),
    ).rejects.toThrow(/futur/);

    const defaults = await db.transaction((tx) => ensureDefaultLocations(tx, ids.tenantId));
    await expect(
      receive(ids, orderId, [{ orderLineId: lineId, qty: "1" }], {
        locationId: defaults.supplierId,
      }),
    ).rejects.toThrow(/Emplacement de réception/);

    await expect(receive(ids, orderId, [{ orderLineId: lineId, qty: "  " }])).rejects.toThrow(
      /au moins une quantité positive/,
    );
  });

  it("écrit réception, mouvement, stock et quantités en une transaction", async () => {
    const ids = await seedPurchasingTenant(db, "pur004-atomic");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const lineId = await firstLineId(orderId, ids.tenantId);

    const result = await receive(ids, orderId, [{ orderLineId: lineId, qty: "2.5" }]);
    expect(result.number).toMatch(/^REC-\d{4}-0001$/);
    expect(result.moveNumber).toMatch(/^MVT-\d{4}-0001$/);

    const [level] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, ids.productId)));
    expect(normalizeQuantity(level?.quantity ?? "")).toBe("2.5");

    const [move] = await db
      .select({ type: stockMoves.type, receptionId: stockMoves.receptionId })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, ids.tenantId));
    expect(move).toMatchObject({ type: "incoming", receptionId: result.receptionId });

    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail?.lines[0]?.receivedQty).toBe("2.5");
    expect(detail?.order.status).toBe("confirmed");
  });

  it("n'écrit rien si une ligne de la réception est refusée", async () => {
    const ids = await seedPurchasingTenant(db, "pur004-rollback");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "2", unitPriceXof: 1000 },
      { articleId: ids.secondProductId, qty: "2", unitPriceXof: 450 },
    ]);
    await confirmOrder(ids, orderId);
    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    const [first, second] = detail?.lines ?? [];
    if (!first || !second) {
      throw new Error("Lignes absentes.");
    }
    await receive(ids, orderId, [{ orderLineId: first.id, qty: "2" }]);

    const [before] = await db
      .select({ value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, ids.tenantId));

    await expect(
      receive(ids, orderId, [
        { orderLineId: first.id, qty: "1" },
        { orderLineId: second.id, qty: "1" },
      ]),
    ).rejects.toThrow(/déjà intégralement reçue/);

    const [after] = await db
      .select({ value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, ids.tenantId));
    const [stock] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(
        and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, ids.secondProductId)),
      );
    expect(after?.value).toBe(before?.value);
    expect(stock).toBeUndefined();
  });

  it("annule par mouvement inverse et refuse si le stock ne suffit pas", async () => {
    const ids = await seedPurchasingTenant(db, "pur004-cancel");
    const orderId = await createOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1000 },
    ]);
    await confirmOrder(ids, orderId);
    const lineId = await firstLineId(orderId, ids.tenantId);
    const reception = await receive(ids, orderId, [{ orderLineId: lineId, qty: "5" }]);

    await db
      .update(stockLevels)
      .set({ quantity: "1" })
      .where(and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, ids.productId)));
    await expect(
      cancelReception(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        receptionId: reception.receptionId,
      }),
    ).rejects.toThrow(/Stock insuffisant/);

    await db
      .update(stockLevels)
      .set({ quantity: "5" })
      .where(and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, ids.productId)));
    const cancelled = await cancelReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      receptionId: reception.receptionId,
    });
    expect(cancelled.moveNumber).toMatch(/^MVT-\d{4}-0002$/);

    const [stock] = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, ids.tenantId), eq(stockLevels.articleId, ids.productId)));
    expect(stock ? normalizeQuantity(stock.quantity) : null).toBe("0");

    const [receptionRow] = await db
      .select({ status: receptions.status })
      .from(receptions)
      .where(eq(receptions.id, reception.receptionId));
    expect(receptionRow?.status).toBe("cancelled");

    const state = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(state?.lines[0]?.receivedQty).toBe("0");
    expect(state?.lines[0]?.receiptState).toBe("not_received");
    expect(state?.order.receiptState).toBe("not_received");
  });
});

describe("PUR-005 — numérotation par tenant et année", () => {
  it("attribue CMD et REC de façon monotone, sans numéro sur brouillon", async () => {
    const ids = await seedPurchasingTenant(db, "pur005");
    const lines = [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }];
    const firstId = await createOrder(ids, lines);
    const secondId = await createOrder(ids, lines);

    const firstDraft = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId: firstId });
    expect(firstDraft?.order.number).toBeNull();

    await confirmOrder(ids, firstId);
    await confirmOrder(ids, secondId);
    const [first, second] = await Promise.all([
      getPurchaseOrder(db, { tenantId: ids.tenantId, orderId: firstId }),
      getPurchaseOrder(db, { tenantId: ids.tenantId, orderId: secondId }),
    ]);
    expect(first?.order.number).toMatch(/-0001$/);
    expect(second?.order.number).toMatch(/-0002$/);

    const firstReception = await receive(ids, firstId, [
      { orderLineId: await firstLineId(firstId, ids.tenantId), qty: "1" },
    ]);
    const secondReception = await receive(ids, secondId, [
      { orderLineId: await firstLineId(secondId, ids.tenantId), qty: "1" },
    ]);
    expect(firstReception.number).toMatch(/^REC-\d{4}-0001$/);
    expect(secondReception.number).toMatch(/^REC-\d{4}-0002$/);
    expect(firstReception.moveNumber).toMatch(/^MVT-\d{4}-0001$/);
    expect(secondReception.moveNumber).toMatch(/^MVT-\d{4}-0002$/);
  });

  it("repart à 0001 pour un autre tenant", async () => {
    const first = await seedPurchasingTenant(db, "pur005-a");
    const second = await seedPurchasingTenant(db, "pur005-b");
    const lines = [{ articleId: first.productId, qty: "1", unitPriceXof: 1000 }];

    const firstOrder = await createOrder(first, lines);
    await confirmOrder(first, firstOrder);

    await createPurchaseOrder(db, {
      tenantId: second.tenantId,
      actorUserId: second.userId,
      data: {
        supplierId: second.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: second.productId, qty: "1", unitPriceXof: 1000 }],
      },
    }).then((created) => confirmOrder(second, created.id));

    const [detailA] = await db
      .select({ number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, first.tenantId));
    const [detailB] = await db
      .select({ number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, second.tenantId));
    expect(detailA?.number).toMatch(/-0001$/);
    expect(detailB?.number).toMatch(/-0001$/);
  });
});

describe("TEN — isolation des achats", () => {
  it("ne lit ni ne modifie la commande d'un autre tenant", async () => {
    const first = await seedPurchasingTenant(db, "ten-a");
    const second = await seedPurchasingTenant(db, "ten-b");
    const orderId = await createOrder(first, [
      { articleId: first.productId, qty: "1", unitPriceXof: 1000 },
    ]);

    expect(await getPurchaseOrder(db, { tenantId: second.tenantId, orderId })).toBeNull();
    await expect(
      transitionPurchaseOrder(db, {
        tenantId: second.tenantId,
        actorUserId: second.userId,
        orderId,
        action: "request",
      }),
    ).rejects.toThrow(/introuvable/);

    const [location] = await listInternalLocations(db, second.tenantId);
    if (!location) {
      throw new Error("Emplacement manquant.");
    }
    await expect(
      createReception(db, {
        tenantId: second.tenantId,
        actorUserId: second.userId,
        orderId,
        locationId: location.id,
        receivedDate: todayIsoDate(),
        notes: null,
        lines: [{ orderLineId: orderId, qty: "1" }],
      }),
    ).rejects.toThrow(/introuvable/);

    const [locationRow] = await db
      .select({ code: stockLocations.code })
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, second.tenantId), eq(stockLocations.type, "internal")))
      .limit(1);
    expect(locationRow?.code).toBe("MAG");
  });
});

describe("PUR-008 — snapshot de paiement et clauses légales sur la commande", () => {
  it("fige les coordonnées bancaires et le délai du fournisseur, avec les clauses légales", async () => {
    const ids = await seedPurchasingTenant(db, "pur-snap");
    const clauses =
      "Réserve de propriété jusqu'au complet paiement. Paiement à 30 jours fin de mois. Pénalités de retard : 1,5 % par mois de retard. Juridiction : tribunal de commerce de Dakar.";

    await db.insert(partnerBankAccounts).values({
      tenantId: ids.tenantId,
      partnerId: ids.supplierId,
      bankName: "Banque du Sahel",
      bankCountryCode: "SN",
      accountHolder: "Sahel Négoce SARL",
      bankCode: "10001",
      branchCode: "00002",
      accountNumber: "000012345678",
      ribKey: "85",
      iban: "SN123456789012345678901234",
      bic: "BDSNSEXX",
    });

    const orderId = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "2", unitPriceXof: 1000 }],
      },
      legalClauses: clauses,
    }).then((created) => created.id);

    const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId });
    expect(detail).not.toBeNull();
    expect(detail!.order.legalClauses).toBe(clauses);

    const payment = await getPurchaseOrderPaymentDetails(db, {
      tenantId: ids.tenantId,
      orderId,
    });
    expect(payment).not.toBeNull();
    expect(payment!.paymentTermDays).toBe(0);
    expect(payment!.bankDetails).toMatchObject({
      bankName: "Banque du Sahel",
      accountHolder: "Sahel Négoce SARL",
      iban: "SN123456789012345678901234",
      bic: "BDSNSEXX",
    });

    const [stored] = await db
      .select({
        legalClauses: purchaseOrders.legalClauses,
        supplierBankDetails: purchaseOrders.supplierBankDetails,
        supplierPaymentTermDays: purchaseOrders.supplierPaymentTermDays,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, ids.tenantId), eq(purchaseOrders.id, orderId)));
    expect(stored?.legalClauses).toBe(clauses);
    expect(stored?.supplierBankDetails).toMatchObject({ bankName: "Banque du Sahel" });
  });

  it("refuse des clauses légales trop longues", async () => {
    const ids = await seedPurchasingTenant(db, "pur-long");
    await expect(
      createPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: {
          supplierId: ids.supplierId,
          expectedReceiptDate: "",
          externalReference: "",
          notes: "",
          lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
        },
        legalClauses: "x".repeat(5001),
      }),
    ).rejects.toThrow(/Clauses légales : 5000 caractères maximum./);
  });
});

describe("PUR-013 — coordonnées bancaires à la création du tiers", () => {
  it("crée un fournisseur avec coordonnées bancaires et les stocke", async () => {
    const ids = await seedPurchasingTenant(db, "pur013-bank");

    const [partner] = await db
      .insert(partners)
      .values({
        tenantId: ids.tenantId,
        code: "FOUR-BANK",
        name: "Fournisseur avec banque",
        type: "company",
        isSupplier: true,
        isCustomer: false,
        active: true,
      })
      .returning({ id: partners.id });

    if (!partner) throw new Error("Partenaire non créé.");

    await savePartnerBankAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      partnerId: partner.id,
      data: {
        bankName: "Banque du Sahel",
        bankCountryCode: "SN",
        accountHolder: "Fournisseur avec banque SARL",
        bankCode: "10001",
        branchCode: "00002",
        accountNumber: "000012345678",
        ribKey: "85",
        iban: "SN123456789012345678901234",
        bic: "BDSNSEXX",
      },
    });

    const [stored] = await db
      .select()
      .from(partnerBankAccounts)
      .where(
        and(
          eq(partnerBankAccounts.tenantId, ids.tenantId),
          eq(partnerBankAccounts.partnerId, partner.id),
        ),
      )
      .limit(1);
    expect(stored).not.toBeNull();
    expect(stored!.bankName).toBe("Banque du Sahel");
    expect(stored!.iban).toBe("SN123456789012345678901234");
    expect(stored!.bic).toBe("BDSNSEXX");
  });

  it("refuse les coordonnées bancaires pour un tiers sans rôle fournisseur", async () => {
    const ids = await seedPurchasingTenant(db, "pur013-nosupplier");

    const [partner] = await db
      .insert(partners)
      .values({
        tenantId: ids.tenantId,
        code: "CLI-NOBANK",
        name: "Client sans banque",
        type: "company",
        isSupplier: false,
        isCustomer: true,
        active: true,
      })
      .returning({ id: partners.id });

    if (!partner) throw new Error("Partenaire non créé.");

    await expect(
      savePartnerBankAccount(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        partnerId: partner.id,
        data: {
          bankName: "Banque X",
          bankCountryCode: null,
          accountHolder: "Client X",
          bankCode: null,
          branchCode: null,
          accountNumber: null,
          ribKey: null,
          iban: "SN123456789012345678901234",
          bic: "BDSNSEXX",
        },
      }),
    ).rejects.toThrow(/Fournisseur introuvable/);
  });

  it("refuse un IBAN invalide", async () => {
    const raw: Record<string, unknown> = {
      bank_name: "Banque",
      account_holder: "Titulaire",
      iban: "INVALID-IBAN",
      bic: "BDSNSEXX",
    };
    const { errors } = validatePartnerBankAccount(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/IBAN/);
  });

  it("crée un tiers sans coordonnées bancaires (comportement normal)", async () => {
    const ids = await seedPurchasingTenant(db, "pur013-nobank");

    const [partner] = await db
      .insert(partners)
      .values({
        tenantId: ids.tenantId,
        code: "FOUR-NOBANK",
        name: "Fournisseur sans banque",
        type: "company",
        isSupplier: true,
        active: true,
      })
      .returning({ id: partners.id });

    if (!partner) throw new Error("Partenaire non créé.");

    const [stored] = await db
      .select()
      .from(partnerBankAccounts)
      .where(
        and(
          eq(partnerBankAccounts.tenantId, ids.tenantId),
          eq(partnerBankAccounts.partnerId, partner.id),
        ),
      )
      .limit(1);
    expect(stored).toBeUndefined();
  });
});

describe("PUR-014 — confirmation réservée à l'assignee de la tâche de validation", () => {
  it("refuse la confirmation par un utilisateur qui n'est pas le validateur assigné", async () => {
    const ids = await seedPurchasingTenant(db, "pur014-validator");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: ids.userId, role: "owner" });
    const [validator] = await db
      .insert(users)
      .values({
        email: "valideur@test.local",
        name: "Valideur Attitré",
        passwordHash: "hash",
      })
      .returning({ id: users.id });
    if (!validator) throw new Error("Validateur non créé.");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: validator.id, role: "member" });

    await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: 0, validatorUserId: validator.id },
    });

    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });

    // Un utilisateur qui n'est pas le validateur ne peut pas confirmer
    await expect(
      transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: order.id,
        action: "confirm",
      }),
    ).rejects.toThrow(/validateur assigné/);

    // Le validateur peut confirmer
    const confirmed = await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: validator.id,
      orderId: order.id,
      action: "confirm",
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("permet à tout gestionnaire de confirmer quand aucun validateur n'est paramétré", async () => {
    const ids = await seedPurchasingTenant(db, "pur014-novalidator");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: ids.userId, role: "owner" });

    await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: 0 },
    });

    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });

    // Aucun validateur paramétré : tout gestionnaire peut confirmer
    const confirmed = await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "confirm",
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("PUR-016 — enregistre la facture fournisseur et valide le 3-Way Match avec bon à payer", async () => {
    const ids = await seedPurchasingTenant(db, "pur016-match");
    await db.transaction(async (tx) => {
      await ensureDefaultLocations(tx, ids.tenantId);
    });
    const locations = await listInternalLocations(db, ids.tenantId);
    const loc = locations[0];
    if (!loc) throw new Error("Emplacement introuvable");

    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "5", unitPriceXof: 10000 }],
      },
    });

    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "confirm",
    });

    const detailBefore = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
    });
    const orderLineId = detailBefore!.lines[0]!.id;

    // Réceptionne les 5 unités
    await createReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      locationId: loc.id,
      receivedDate: todayIsoDate(),
      notes: "Réception intégrale",
      lines: [{ orderLineId, qty: "5" }],
    });

    // Enregistrement de la facture fournisseur conforme
    const matchResult = await recordSupplierInvoiceAndMatch(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: ids.userId,
      supplierInvoiceNumber: "FAC-FOURN-001",
      supplierInvoiceDate: todayIsoDate(),
      lines: [{ orderLineId, invoicedQty: "5", invoicedUnitPriceXof: 10000 }],
    });

    expect(matchResult.status).toBe("matched");
    expect(matchResult.isApprovedForPayment).toBe(true);
    expect(matchResult.totalInvoicedXof).toBe(50000);
    expect(matchResult.netDiscrepancyXof).toBe(0);

    // Vérifie que getPurchaseOrder restitue le statut et l'autorisation
    const detailAfter = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
    });
    expect(detailAfter!.order.matchingStatus).toBe("matched");
    expect(detailAfter!.order.supplierInvoiceNumber).toBe("FAC-FOURN-001");
    expect(detailAfter!.order.supplierInvoiceAmountXof).toBe(50000);
    expect(detailAfter!.order.matchedAt).toBeInstanceOf(Date);
  });

  it("PUR-016 — bloque le paiement en cas de surfacturation et permet la résolution par dérogation", async () => {
    const ids = await seedPurchasingTenant(db, "pur016-dispute");
    await db.transaction(async (tx) => {
      await ensureDefaultLocations(tx, ids.tenantId);
    });
    const locations = await listInternalLocations(db, ids.tenantId);
    const loc = locations[0];
    if (!loc) throw new Error("Emplacement introuvable");

    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "10", unitPriceXof: 5000 }],
      },
    });

    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "confirm",
    });

    const detailBefore = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
    });
    const orderLineId = detailBefore!.lines[0]!.id;

    // Réceptionne 6 unités seulement sur 10
    await createReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      locationId: loc.id,
      receivedDate: todayIsoDate(),
      notes: "Livraison partielle",
      lines: [{ orderLineId, qty: "6" }],
    });

    // Facture portant sur 10 unités -> surfacturation de 4 unités (20 000 XOF)
    const matchResult = await recordSupplierInvoiceAndMatch(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: ids.userId,
      supplierInvoiceNumber: "FAC-EXCESS-02",
      supplierInvoiceDate: todayIsoDate(),
      lines: [{ orderLineId, invoicedQty: "10", invoicedUnitPriceXof: 5000 }],
    });

    expect(matchResult.status).toBe("quantity_mismatch");
    expect(matchResult.isApprovedForPayment).toBe(false);
    expect(matchResult.netDiscrepancyXof).toBe(20000);

    const detailDisputed = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
    });
    expect(detailDisputed!.order.matchingStatus).toBe("quantity_mismatch");

    // Résolution du litige par accord / dérogation
    await resolveMatchingDispute(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: ids.userId,
      resolutionNotes: "Avoir reçu N° AV-999 de 20 000 XOF pour compenser le reliquat",
    });

    const detailResolved = await getPurchaseOrder(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
    });
    expect(detailResolved!.order.matchingStatus).toBe("matched");
    expect(detailResolved!.order.disputeNotes).toContain("Avoir reçu");
  });
});
