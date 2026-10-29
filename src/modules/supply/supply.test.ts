import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  articleSupplyPolicies,
  articles,
  auditEvents,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockLevels,
  stockLocations,
  supplyRunLines,
  supplyRuns,
  tenderInvitations,
  tenderRequestLines,
  tenderRequests,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { computeSupplyProposal } from "./calculation";
import { parseDismissReason, parseSupplyPolicy, validateSupplyPolicyTarget } from "./policy";
import { groupSupplyLines } from "./proposals";
import {
  dismissSupplyLine,
  generateSupplyPurchaseOrders,
  generateSupplyTender,
  getSupplyRun,
  listSupplyPolicies,
  listSupplyRuns,
  runSupplyCalculation,
  saveSupplyPolicy,
} from "./queries";

const TODAY = "2026-10-29";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface SupplyTenant extends PurchasingTenant {
  readonly locationId: string;
  readonly secondSupplierId: string;
  readonly supplierEmail: string;
  readonly emailLessSupplierId: string;
}

let counter = 0;

async function setup(label: string): Promise<SupplyTenant> {
  counter += 1;
  const ids = await seedPurchasingTenant(db, `${label}-${counter}`);

  const [location] = await db
    .insert(stockLocations)
    .values({
      tenantId: ids.tenantId,
      code: "MAG",
      name: "Magasin central",
      type: "internal",
    })
    .returning({ id: stockLocations.id });
  if (!location) {
    throw new Error("Emplacement de test non créé.");
  }

  await db
    .update(partners)
    .set({ email: "sahel@test.local" })
    .where(eq(partners.id, ids.supplierId));

  const [secondSupplier] = await db
    .insert(partners)
    .values({
      tenantId: ids.tenantId,
      code: "FOUR003",
      name: "Bamako Métal SARL",
      type: "company" as const,
      isSupplier: true,
      email: "bamako@test.local",
    })
    .returning({ id: partners.id });
  const [emailLess] = await db
    .insert(partners)
    .values({
      tenantId: ids.tenantId,
      code: "FOUR004",
      name: "Fournisseur sans e-mail",
      type: "company" as const,
      isSupplier: true,
    })
    .returning({ id: partners.id });
  if (!secondSupplier || !emailLess) {
    throw new Error("Fournisseurs de test non créés.");
  }

  return {
    ...ids,
    locationId: location.id,
    secondSupplierId: secondSupplier.id,
    emailLessSupplierId: emailLess.id,
    supplierEmail: "sahel@test.local",
  };
}

async function setStock(ids: SupplyTenant, articleId: string, qty: string): Promise<void> {
  const existing = await db
    .select({ id: stockLevels.id })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, ids.tenantId),
        eq(stockLevels.locationId, ids.locationId),
        eq(stockLevels.articleId, articleId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db.update(stockLevels).set({ quantity: qty }).where(eq(stockLevels.id, existing[0].id));
    return;
  }
  await db.insert(stockLevels).values({
    tenantId: ids.tenantId,
    locationId: ids.locationId,
    articleId,
    quantity: qty,
  });
}

async function savePolicy(
  ids: SupplyTenant,
  articleId: string,
  overrides: Partial<{
    supplierId: string;
    leadTimeDays: string;
    safetyDelayDays: string;
    minStockQty: string;
    reorderQty: string;
    orderMultipleQty: string;
    active: boolean;
  }> = {},
) {
  return saveSupplyPolicy(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    articleId,
    active: overrides.active ?? true,
    data: {
      supplierId: overrides.supplierId ?? ids.supplierId,
      leadTimeDays: overrides.leadTimeDays ?? "5",
      safetyDelayDays: overrides.safetyDelayDays ?? "1",
      minStockQty: overrides.minStockQty ?? "5",
      reorderQty: overrides.reorderQty ?? "0",
      orderMultipleQty: overrides.orderMultipleQty ?? "",
    },
  });
}

async function createPurchaseLine(
  ids: SupplyTenant,
  input: {
    status: "draft" | "requested" | "confirmed" | "closed" | "cancelled";
    qty: string;
    receivedQty?: string;
    articleId?: string;
    expectedDate?: string | null;
    supplierId?: string;
  },
): Promise<void> {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      tenantId: ids.tenantId,
      supplierId: input.supplierId ?? ids.supplierId,
      status: input.status,
      orderDate: TODAY,
      expectedReceiptDate: input.expectedDate ?? null,
      exTaxTotal: 0,
    })
    .returning({ id: purchaseOrders.id });
  if (!order) {
    throw new Error("Commande fournisseur de test non créée.");
  }
  const received = input.receivedQty ?? "0";
  await db.insert(purchaseOrderLines).values({
    tenantId: ids.tenantId,
    orderId: order.id,
    lineNumber: 1,
    articleId: input.articleId ?? ids.productId,
    name: "Ligne de test",
    unitCode: "KG",
    qty: input.qty,
    unitPriceXof: 1000,
    lineTotalXof: 0,
    receivedQty: received,
    receiptState:
      received === "0"
        ? "not_received"
        : received === input.qty
          ? "received"
          : "partially_received",
  });
}

async function createSaleLine(
  ids: SupplyTenant,
  input: {
    status: "draft" | "confirmed" | "closed" | "cancelled";
    qty: string;
    expectedDate?: string;
    articleId?: string;
  },
): Promise<void> {
  const [order] = await db
    .insert(salesOrders)
    .values({
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      status: input.status,
      orderDate: TODAY,
      expectedDeliveryDate: input.expectedDate ?? null,
      exTaxTotal: 0,
    })
    .returning({ id: salesOrders.id });
  if (!order) {
    throw new Error("Commande client de test non créée.");
  }
  await db.insert(salesOrderLines).values({
    tenantId: ids.tenantId,
    orderId: order.id,
    lineNumber: 1,
    articleId: input.articleId ?? ids.productId,
    name: "Ligne de test",
    unitCode: "KG",
    qty: input.qty,
    unitPriceXof: 1000,
    lineTotalXof: 0,
    deliveredQty: "0",
    deliveryState: "not_delivered",
  });
}

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("SCM-007 politique d'approvisionnement", () => {
  it("refuse une politique incomplète ou hors bornes", () => {
    const missing = parseSupplyPolicy({});
    expect(missing.values).toBeNull();
    expect(missing.errors).toContain("Fournisseur par défaut : obligatoire.");

    const tooSlow = parseSupplyPolicy({
      supplierId: "four",
      leadTimeDays: "400",
      safetyDelayDays: "61",
      minStockQty: "5",
      reorderQty: "0",
    });
    expect(tooSlow.values).toBeNull();
    expect(tooSlow.errors.join(" ")).toContain("365 jours maximum");
    expect(tooSlow.errors.join(" ")).toContain("60 jours maximum");

    const negative = parseSupplyPolicy({
      supplierId: "four",
      leadTimeDays: "5",
      safetyDelayDays: "1",
      minStockQty: "-1",
      reorderQty: "0",
    });
    expect(negative.values).toBeNull();

    const tooPrecise = parseSupplyPolicy({
      supplierId: "four",
      leadTimeDays: "5",
      safetyDelayDays: "1",
      minStockQty: "1.1234567",
      reorderQty: "0",
    });
    expect(tooPrecise.values).toBeNull();

    const zeroMultiple = parseSupplyPolicy({
      supplierId: "four",
      leadTimeDays: "5",
      safetyDelayDays: "1",
      minStockQty: "5",
      reorderQty: "0",
      orderMultipleQty: "0",
    });
    expect(zeroMultiple.values).toBeNull();
  });

  it("accepte une politique complète et normalise les quantités", () => {
    const parsed = parseSupplyPolicy({
      supplierId: "four",
      leadTimeDays: "12",
      safetyDelayDays: "2",
      minStockQty: "10.000000",
      reorderQty: "25,5",
      orderMultipleQty: "5",
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.values).toEqual({
      supplierId: "four",
      leadTimeDays: 12,
      safetyDelayDays: 2,
      minStockQty: "10",
      reorderQty: "25.5",
      orderMultipleQty: "5",
    });
  });

  it("refuse un service, un article inactif ou non achetable et un fournisseur invalide", () => {
    expect(
      validateSupplyPolicyTarget({
        article: { code: "SRV001", type: "service", active: true, isPurchasable: true },
        supplier: { code: "FOUR001", active: true, isSupplier: true },
      }).join(" "),
    ).toContain("service");

    expect(
      validateSupplyPolicyTarget({
        article: { code: "ART003", type: "product", active: false, isPurchasable: true },
        supplier: { code: "FOUR001", active: true, isSupplier: true },
      }).join(" "),
    ).toContain("inactif");

    expect(
      validateSupplyPolicyTarget({
        article: { code: "ART004", type: "product", active: true, isPurchasable: false },
        supplier: { code: "FOUR001", active: true, isSupplier: true },
      }).join(" "),
    ).toContain("n'est pas achetable");

    expect(
      validateSupplyPolicyTarget({
        article: { code: "ART001", type: "product", active: true, isPurchasable: true },
        supplier: { code: "FOUR002", active: false, isSupplier: true },
      }).join(" "),
    ).toContain("inactif");

    expect(
      validateSupplyPolicyTarget({
        article: { code: "ART001", type: "product", active: true, isPurchasable: true },
        supplier: { code: "CUST001", active: true, isSupplier: false },
      }).join(" "),
    ).toContain("rôle fournisseur");
  });

  it("enregistre, met à jour et désactive une politique sans doublon, avec audit", async () => {
    const ids = await setup("politique");
    await savePolicy(ids, ids.productId, { minStockQty: "12", reorderQty: "4" });
    await savePolicy(ids, ids.productId, { minStockQty: "15", reorderQty: "6", active: false });

    const rows = await db
      .select()
      .from(articleSupplyPolicies)
      .where(eq(articleSupplyPolicies.tenantId, ids.tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.minStockQty).toBe("15.000000");
    expect(rows[0]?.reorderQty).toBe("6.000000");
    expect(rows[0]?.active).toBe(false);

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "supply.policy.save")),
      );
    expect(audits).toHaveLength(2);
    expect(audits[1]?.details).toMatchObject({ articleCode: "ART001", active: false });

    const page = await listSupplyPolicies(db, ids.tenantId);
    const row = page.rows.find((candidate) => candidate.articleId === ids.productId);
    expect(row?.supplierName).toBe("Sahel Négoce SARL");
    expect(row?.active).toBe(false);
    expect(page.suppliers.map((supplier) => supplier.code)).toContain("FOUR001");
  });

  it("refuse un article d'un autre espace et un fournisseur de rôle client", async () => {
    const first = await setup("politique-a");
    const second = await setup("politique-b");

    await expect(
      saveSupplyPolicy(db, {
        tenantId: first.tenantId,
        actorUserId: first.userId,
        articleId: second.productId,
        active: true,
        data: {
          supplierId: first.supplierId,
          leadTimeDays: "5",
          safetyDelayDays: "0",
          minStockQty: "1",
          reorderQty: "0",
        },
      }),
    ).rejects.toThrow("Article introuvable dans cet espace de travail.");

    await expect(
      savePolicy(first, first.productId, { supplierId: first.customerId }),
    ).rejects.toThrow("rôle fournisseur");
  });
});

describe("SCM-008 calcul des besoins", () => {
  const base = {
    today: TODAY,
    horizonDays: 30,
    stockQty: "10",
    minStockQty: "5",
    reorderQty: "0",
    orderMultipleQty: null,
    leadTimeDays: 0,
    safetyDelayDays: 0,
    events: [],
  } as const;

  it("ne propose rien quand le stock suffit", () => {
    expect(computeSupplyProposal(base)).toBeNull();
  });

  it("propose au jour même quand le stock est déjà sous le seuil", () => {
    const proposal = computeSupplyProposal({ ...base, stockQty: "2", minStockQty: "5" });
    expect(proposal).toMatchObject({
      proposedQty: "3",
      needDate: TODAY,
      orderDate: TODAY,
      late: false,
      projectedQty: "2",
    });
  });

  it("propose à la date de sortie qui perce le seuil, avec quantité et multiple", () => {
    const proposal = computeSupplyProposal({
      ...base,
      reorderQty: "8",
      orderMultipleQty: "5",
      leadTimeDays: 2,
      safetyDelayDays: 1,
      events: [{ date: addDays(TODAY, 5), direction: "out", qty: "6" }],
    });
    expect(proposal).toMatchObject({
      needDate: addDays(TODAY, 5),
      orderDate: addDays(TODAY, 2),
      late: false,
      projectedQty: "4",
      proposedQty: "10",
      outgoingQty: "6",
    });
  });

  it("couvre le besoin par une entrée antérieure et ignore ce qui dépasse l'horizon", () => {
    expect(
      computeSupplyProposal({
        ...base,
        events: [
          { date: addDays(TODAY, 2), direction: "in", qty: "6" },
          { date: addDays(TODAY, 5), direction: "out", qty: "6" },
          { date: addDays(TODAY, 40), direction: "out", qty: "90" },
        ],
      }),
    ).toBeNull();
  });

  it("propose à la sortie quand l'entrée arrive trop tard", () => {
    const proposal = computeSupplyProposal({
      ...base,
      events: [
        { date: addDays(TODAY, 4), direction: "out", qty: "6" },
        { date: addDays(TODAY, 6), direction: "in", qty: "6" },
      ],
    });
    expect(proposal?.needDate).toBe(addDays(TODAY, 4));
    expect(proposal?.projectedQty).toBe("4");
  });

  it("ramène la date de commande au jour et signale le retard", () => {
    const proposal = computeSupplyProposal({
      ...base,
      leadTimeDays: 10,
      safetyDelayDays: 3,
      events: [{ date: addDays(TODAY, 2), direction: "out", qty: "6" }],
    });
    expect(proposal).toMatchObject({
      needDate: addDays(TODAY, 2),
      orderDate: TODAY,
      late: true,
    });
  });

  it("traite une date absente comme due le jour du calcul", () => {
    const proposal = computeSupplyProposal({
      ...base,
      events: [{ date: null, direction: "out", qty: "6" }],
    });
    expect(proposal?.needDate).toBe(TODAY);
  });

  it("ne retient que les commandes confirmées et les articles approvisionnables", async () => {
    const ids = await setup("calcul");
    await savePolicy(ids, ids.productId, { minStockQty: "5", reorderQty: "0" });
    await savePolicy(ids, ids.secondProductId, { minStockQty: "5", reorderQty: "0" });
    await db.insert(articleSupplyPolicies).values({
      tenantId: ids.tenantId,
      articleId: ids.serviceId,
      supplierId: ids.supplierId,
      leadTimeDays: 5,
      safetyDelayDays: 1,
      minStockQty: "5",
      reorderQty: "0",
    });

    await setStock(ids, ids.productId, "6");
    await setStock(ids, ids.secondProductId, "6");

    await createPurchaseLine(ids, {
      status: "draft",
      qty: "20",
      expectedDate: addDays(TODAY, 3),
    });
    await createPurchaseLine(ids, {
      status: "cancelled",
      qty: "20",
      expectedDate: addDays(TODAY, 3),
    });
    await createPurchaseLine(ids, {
      status: "confirmed",
      qty: "2",
      expectedDate: addDays(TODAY, 2),
      articleId: ids.secondProductId,
    });

    await createSaleLine(ids, { status: "draft", qty: "9", expectedDate: addDays(TODAY, 2) });
    await createSaleLine(ids, { status: "confirmed", qty: "4", expectedDate: addDays(TODAY, 5) });
    await createSaleLine(ids, { status: "confirmed", qty: "9", expectedDate: addDays(TODAY, 40) });
    await createSaleLine(ids, {
      status: "confirmed",
      qty: "3",
      expectedDate: addDays(TODAY, 10),
      articleId: ids.secondProductId,
    });

    const result = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    expect(result).toMatchObject({ lineCount: 2, proposalCount: 1 });

    const detail = await getSupplyRun(db, ids.tenantId, result.id);
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]).toMatchObject({
      articleId: ids.productId,
      stockQty: "6.000000",
      incomingQty: "0.000000",
      outgoingQty: "4.000000",
      proposedQty: "3.000000",
      needDate: addDays(TODAY, 5),
    });
  });
});

describe("SCM-009 calcul figé et numéroté", () => {
  it("numérote, date et fige chaque calcul, sans réécrire l'historique", async () => {
    const ids = await setup("historique");
    await savePolicy(ids, ids.productId, { minStockQty: "10", reorderQty: "0" });
    await setStock(ids, ids.productId, "0");

    const first = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    expect(first.number).toBe("BES-2026-0001");
    expect(first).toMatchObject({ lineCount: 1, proposalCount: 1 });

    await savePolicy(ids, ids.productId, { minStockQty: "50", reorderQty: "0" });

    const second = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "60",
      today: TODAY,
    });
    expect(second.number).toBe("BES-2026-0002");
    expect(second.proposalCount).toBe(1);

    const firstDetail = await getSupplyRun(db, ids.tenantId, first.id);
    expect(firstDetail?.lines[0]?.proposedQty).toBe("10.000000");
    expect(firstDetail?.lines[0]?.minStockQty).toBe("10.000000");
    const secondDetail = await getSupplyRun(db, ids.tenantId, second.id);
    expect(secondDetail?.lines[0]?.proposedQty).toBe("50.000000");
    expect(secondDetail?.run.horizonDays).toBe(60);

    const runs = await listSupplyRuns(db, ids.tenantId);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.number).toBe("BES-2026-0002");
    expect(runs[0]?.pendingCount).toBe(1);

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "supply.run.calculate")),
      );
    expect(audits).toHaveLength(2);
    expect(audits[0]?.details).toMatchObject({ number: "BES-2026-0001", proposalCount: 1 });
  });

  it("refuse un horizon hors bornes et cloisonne les calculs par espace", async () => {
    const ids = await setup("isolation");
    await savePolicy(ids, ids.productId, { minStockQty: "10", reorderQty: "0" });
    await setStock(ids, ids.productId, "0");

    await expect(
      runSupplyCalculation(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        horizonDays: "0",
        today: TODAY,
      }),
    ).rejects.toThrow("Horizon");
    await expect(
      runSupplyCalculation(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        horizonDays: "400",
        today: TODAY,
      }),
    ).rejects.toThrow("Horizon");

    const other = await setup("isolation-other");
    const run = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    expect(await getSupplyRun(db, other.tenantId, run.id)).toBeNull();
    expect(await listSupplyRuns(db, other.tenantId)).toHaveLength(0);
  });
});

describe("SCM-010 propositions d'achat", () => {
  async function shortageRun(ids: SupplyTenant) {
    await savePolicy(ids, ids.productId, {
      minStockQty: "10",
      reorderQty: "0",
      leadTimeDays: "3",
      safetyDelayDays: "0",
    });
    await savePolicy(ids, ids.secondProductId, {
      minStockQty: "10",
      reorderQty: "0",
      leadTimeDays: "3",
      safetyDelayDays: "0",
    });
    await setStock(ids, ids.productId, "0");
    await setStock(ids, ids.secondProductId, "0");
    return runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
  }

  it("groupe les propositions par fournisseur en commandes brouillon traçables", async () => {
    const ids = await setup("commandes");
    const run = await shortageRun(ids);
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    expect(detail?.lines).toHaveLength(2);

    const lineIds = (detail?.lines ?? []).map((line) => line.id);
    const result = await generateSupplyPurchaseOrders(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      runId: run.id,
      lineIds,
      grouping: "supplier",
      today: TODAY,
    });
    expect(result.orderIds).toHaveLength(1);

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, result.orderIds[0]!));
    if (!order) {
      throw new Error("Commande générée introuvable.");
    }
    expect(order).toMatchObject({
      status: "draft",
      number: null,
      externalReference: run.number,
      supplyRunId: run.id,
      expectedReceiptDate: TODAY,
      exTaxTotal: 14500,
    });

    const orderLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, order.id))
      .orderBy(asc(purchaseOrderLines.lineNumber));
    expect(orderLines).toHaveLength(2);
    const lineByArticle = new Map(orderLines.map((line) => [line.articleId, line]));
    expect(lineByArticle.get(ids.productId)).toMatchObject({
      qty: "10.000000",
      unitPriceXof: 1000,
      lineTotalXof: 10000,
    });
    expect(lineByArticle.get(ids.secondProductId)).toMatchObject({
      qty: "10.000000",
      unitPriceXof: 450,
      lineTotalXof: 4500,
    });

    const after = await getSupplyRun(db, ids.tenantId, run.id);
    expect(after?.lines.every((line) => line.decision === "ordered")).toBe(true);
    expect(after?.lines[0]?.convertedDocumentId).toBe(order.id);

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, ids.tenantId));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(["purchase.order.create", "supply.orders.create"]),
    );
  });

  it("sépare par fournisseur et date de besoin quand demandé", () => {
    const groups = groupSupplyLines(
      [
        { id: "a", supplierId: "s1", needDate: "2026-11-01" },
        { id: "b", supplierId: "s1", needDate: "2026-11-05" },
        { id: "c", supplierId: "s2", needDate: "2026-11-01" },
      ],
      "supplier_date",
    );
    expect(groups).toHaveLength(3);
    expect(
      groupSupplyLines([{ id: "a", supplierId: "s1", needDate: "2026-11-05" }], "supplier")[0]
        ?.needDate,
    ).toBe("2026-11-05");
  });

  it("refuse une ligne déjà convertie, écartée ou d'un autre espace", async () => {
    const ids = await setup("commandes-garde");
    const run = await shortageRun(ids);
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    const line = detail?.lines[0];
    if (!line) {
      throw new Error("Proposition de test absente.");
    }

    await generateSupplyPurchaseOrders(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      runId: run.id,
      lineIds: [line.id],
      grouping: "supplier",
      today: TODAY,
    });
    await expect(
      generateSupplyPurchaseOrders(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: run.id,
        lineIds: [line.id],
        grouping: "supplier",
        today: TODAY,
      }),
    ).rejects.toThrow("déjà traitée");

    const dismissedLine = detail?.lines[1];
    if (!dismissedLine) {
      throw new Error("Seconde proposition de test absente.");
    }
    await dismissSupplyLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      runId: run.id,
      lineId: dismissedLine.id,
      reason: "Fournisseur en rupture.",
    });
    await expect(
      generateSupplyPurchaseOrders(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: run.id,
        lineIds: [dismissedLine.id],
        grouping: "supplier",
        today: TODAY,
      }),
    ).rejects.toThrow("déjà traitée");

    const other = await setup("commandes-garde-other");
    await expect(
      generateSupplyPurchaseOrders(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        runId: run.id,
        lineIds: [line.id],
        grouping: "supplier",
        today: TODAY,
      }),
    ).rejects.toThrow("introuvable");
  });

  it("refuse un article devenu inactif après le calcul", async () => {
    const ids = await setup("commandes-article");
    const run = await shortageRun(ids);
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    const line = detail?.lines[0];
    if (!line) {
      throw new Error("Proposition de test absente.");
    }

    await db
      .update(articles)
      .set({ active: false })
      .where(and(eq(articles.tenantId, ids.tenantId), eq(articles.id, line.articleId)));

    await expect(
      generateSupplyPurchaseOrders(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: run.id,
        lineIds: [line.id],
        grouping: "supplier",
        today: TODAY,
      }),
    ).rejects.toThrow("n'est plus actif et achetable");
  });
});

describe("SCM-011 demande de cotation depuis les besoins", () => {
  it("crée un brouillon de cotation avec lignes, invitations et référence du calcul", async () => {
    const ids = await setup("cotation");
    await savePolicy(ids, ids.productId, {
      minStockQty: "10",
      reorderQty: "0",
      supplierId: ids.supplierId,
    });
    await savePolicy(ids, ids.secondProductId, {
      minStockQty: "10",
      reorderQty: "0",
      supplierId: ids.secondSupplierId,
    });
    await setStock(ids, ids.productId, "0");
    await setStock(ids, ids.secondProductId, "0");

    const run = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    const lineIds = (detail?.lines ?? []).map((line) => line.id);
    expect(lineIds).toHaveLength(2);

    const deadline = addDays(TODAY, 7);
    const created = await generateSupplyTender(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      runId: run.id,
      lineIds,
      deadline,
      today: TODAY,
    });

    const [tender] = await db
      .select()
      .from(tenderRequests)
      .where(eq(tenderRequests.id, created.id));
    expect(tender).toMatchObject({
      status: "draft",
      number: null,
      deadline,
      supplyRunId: run.id,
      title: `Réapprovisionnement ${run.number}`,
    });
    expect(tender?.notes).toContain(run.number);

    const lines = await db
      .select()
      .from(tenderRequestLines)
      .where(eq(tenderRequestLines.tenderId, created.id))
      .orderBy(asc(tenderRequestLines.lineNumber));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: "10.000000", requestedDate: TODAY });

    const invitations = await db
      .select()
      .from(tenderInvitations)
      .where(eq(tenderInvitations.tenderId, created.id));
    expect(invitations).toHaveLength(2);
    expect(invitations.map((row) => row.recipientEmail).sort()).toEqual([
      "bamako@test.local",
      "sahel@test.local",
    ]);

    const after = await getSupplyRun(db, ids.tenantId, run.id);
    expect(after?.lines.every((line) => line.decision === "tendered")).toBe(true);

    const audits = await db
      .select({ action: auditEvents.action, details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, ids.tenantId));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(["tender.create", "supply.tender.create"]),
    );
    const source = audits.find((row) => row.action === "tender.create");
    expect(source?.details).toMatchObject({ source: "supply_run", supplyRun: run.number });
  });

  it("refuse une échéance passée et un fournisseur sans e-mail sans rien écrire", async () => {
    const ids = await setup("cotation-garde");
    await savePolicy(ids, ids.productId, { minStockQty: "10", reorderQty: "0" });
    await setStock(ids, ids.productId, "0");
    const run = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    const line = detail?.lines[0];
    if (!line) {
      throw new Error("Proposition de test absente.");
    }

    await expect(
      generateSupplyTender(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: run.id,
        lineIds: [line.id],
        deadline: addDays(TODAY, -1),
        today: TODAY,
      }),
    ).rejects.toThrow("Échéance");

    await savePolicy(ids, ids.productId, {
      minStockQty: "10",
      reorderQty: "0",
      supplierId: ids.emailLessSupplierId,
    });
    const secondRun = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    const secondDetail = await getSupplyRun(db, ids.tenantId, secondRun.id);
    const secondLine = secondDetail?.lines[0];
    if (!secondLine) {
      throw new Error("Seconde proposition de test absente.");
    }

    const [before] = await db
      .select({ id: tenderRequests.id })
      .from(tenderRequests)
      .where(eq(tenderRequests.tenantId, ids.tenantId));
    expect(before).toBeUndefined();

    await expect(
      generateSupplyTender(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: secondRun.id,
        lineIds: [secondLine.id],
        deadline: addDays(TODAY, 5),
        today: TODAY,
      }),
    ).rejects.toThrow("adresse e-mail valide");

    const [after] = await db
      .select({ id: tenderRequests.id })
      .from(tenderRequests)
      .where(eq(tenderRequests.tenantId, ids.tenantId));
    expect(after).toBeUndefined();
  });
});

describe("SCM-012 écart d'une proposition", () => {
  it("exige un motif borné et fige l'écart avec audit", () => {
    expect(parseDismissReason("  ").error).toContain("obligatoire");
    expect(parseDismissReason("x".repeat(501)).error).toContain("500");
    expect(parseDismissReason("  rupture  ")).toEqual({ reason: "rupture", error: null });
  });

  it("écarte une proposition en attente, refuse une ligne convertie ou d'un autre espace", async () => {
    const ids = await setup("ecart");
    await savePolicy(ids, ids.productId, { minStockQty: "10", reorderQty: "0" });
    await setStock(ids, ids.productId, "0");
    const run = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    const detail = await getSupplyRun(db, ids.tenantId, run.id);
    const line = detail?.lines[0];
    if (!line) {
      throw new Error("Proposition de test absente.");
    }

    const other = await setup("ecart-other");
    await expect(
      dismissSupplyLine(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        runId: run.id,
        lineId: line.id,
        reason: "Test croisé.",
      }),
    ).rejects.toThrow("introuvable");

    await dismissSupplyLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      runId: run.id,
      lineId: line.id,
      reason: "Rupture fournisseur.",
    });
    const after = await getSupplyRun(db, ids.tenantId, run.id);
    expect(after?.lines[0]).toMatchObject({
      decision: "dismissed",
      decisionReason: "Rupture fournisseur.",
    });

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "supply.line.dismiss")),
      );
    expect(audits[0]?.details).toMatchObject({ lineNumber: 1, reason: "Rupture fournisseur." });

    await expect(
      dismissSupplyLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        runId: run.id,
        lineId: line.id,
        reason: "Deuxième écart.",
      }),
    ).rejects.toThrow("en attente");
  });
});

describe("Schéma 8B", () => {
  it("persiste les lignes de calcul et les commandes liées", async () => {
    const ids = await setup("schema");
    await savePolicy(ids, ids.productId, { minStockQty: "10", reorderQty: "0" });
    await setStock(ids, ids.productId, "0");
    const run = await runSupplyCalculation(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      horizonDays: "30",
      today: TODAY,
    });
    const [stored] = await db
      .select()
      .from(supplyRuns)
      .where(and(eq(supplyRuns.tenantId, ids.tenantId), eq(supplyRuns.id, run.id)));
    expect(stored?.number).toBe(run.number);
    const lineRows = await db.select().from(supplyRunLines).where(eq(supplyRunLines.runId, run.id));
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0]?.decision).toBe("pending");
  });
});
