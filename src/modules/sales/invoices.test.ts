import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, invoiceLines, invoicePayments, invoices, salesOrderLines } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant, type SalesTenant } from "@/test/sales";
import { todayIsoDate } from "@/lib/dates";
import { SalesError } from "./errors";
import { createDelivery } from "./deliveries";
import { createInvoice, validateInvoice } from "./invoices";
import { createInvoicePayment } from "./payments";
import {
  createSalesOrder,
  getInvoice,
  getReceivablesStats,
  getSalesOrder,
  listInvoices,
  transitionSalesOrder,
} from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

const YEAR = todayIsoDate().slice(0, 4);

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface OrderFixture {
  readonly orderId: string;
  readonly lineIds: readonly string[];
}

async function createConfirmedOrder(
  ids: SalesTenant,
  lines: readonly { articleId: string; qty: string; unitPriceXof: number }[],
): Promise<OrderFixture> {
  const created = await createSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      customerId: ids.customerId,
      expectedDeliveryDate: "",
      externalReference: "",
      incoterm: "",
      notes: "",
      lines,
    },
  });
  await transitionSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: created.id,
    action: "confirm",
  });
  const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: created.id });
  if (!detail) {
    throw new Error("Commande confirmée introuvable.");
  }
  return { orderId: created.id, lineIds: detail.lines.map((line) => line.id) };
}

async function deliver(
  ids: SalesTenant,
  orderId: string,
  lines: readonly { orderLineId: string; qty: string }[],
): Promise<void> {
  await createDelivery(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: ids.locationId,
    deliveredDate: todayIsoDate(),
    notes: null,
    lines,
  });
}

interface InvoiceOptions {
  readonly invoiceDate?: string;
  readonly dueDate?: string;
  readonly notes?: string | null;
}

async function draftInvoice(
  ids: SalesTenant,
  orderId: string,
  lines: readonly { orderLineId: string; qty: unknown }[],
  options: InvoiceOptions = {},
) {
  return createInvoice(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    invoiceDate: options.invoiceDate ?? todayIsoDate(),
    dueDate: options.dueDate ?? options.invoiceDate ?? todayIsoDate(),
    notes: options.notes ?? null,
    lines,
  });
}

async function issueInvoice(
  ids: SalesTenant,
  orderId: string,
  lines: readonly { orderLineId: string; qty: unknown }[],
  options: InvoiceOptions = {},
): Promise<{ invoiceId: string; number: string; exTaxTotal: number }> {
  const draft = await draftInvoice(ids, orderId, lines, options);
  const validated = await validateInvoice(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    invoiceId: draft.invoiceId,
  });
  return { invoiceId: draft.invoiceId, number: validated.number, exTaxTotal: draft.exTaxTotal };
}

async function invoiceRow(invoiceId: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!row) {
    throw new Error("Facture introuvable.");
  }
  return row;
}

async function orderLineRow(ids: SalesTenant, lineId: string) {
  const [row] = await db
    .select()
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.tenantId, ids.tenantId), eq(salesOrderLines.id, lineId)));
  if (!row) {
    throw new Error("Ligne de commande introuvable.");
  }
  return row;
}

describe("SAL-005 — facturation depuis une commande confirmée", () => {
  it("refuse une commande brouillon, une facture vide et un produit non livré", async () => {
    const ids = await seedSalesTenant(db, "sal005-gardes");
    const draft = await createSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        customerId: ids.customerId,
        expectedDeliveryDate: "",
        externalReference: "",
        incoterm: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "2", unitPriceXof: 1500 }],
      },
    });

    await expect(
      draftInvoice(ids, draft.id, [
        { orderLineId: (await orderLinesOf(ids, draft.id))[0]!, qty: "1" },
      ]),
    ).rejects.toThrow("Une facture se génère depuis une commande confirmée.");

    const order = await createConfirmedOrder(ids, [
      { articleId: ids.productId, qty: "10", unitPriceXof: 1500 },
    ]);
    const orderLineId = order.lineIds[0]!;

    await expect(draftInvoice(ids, order.orderId, [])).rejects.toThrow(
      "Facture : au moins une quantité positive est obligatoire.",
    );
    await expect(draftInvoice(ids, order.orderId, [{ orderLineId, qty: "" }])).rejects.toThrow(
      "Facture : au moins une quantité positive est obligatoire.",
    );
    await expect(draftInvoice(ids, order.orderId, [{ orderLineId, qty: "1" }])).rejects.toThrow(
      "Ligne 1 : aucune quantité facturable restante.",
    );

    const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: order.orderId });
    expect(detail?.invoices).toHaveLength(0);
  });

  it("facture les produits livrés au fur et à mesure et suit les états", async () => {
    const ids = await seedSalesTenant(db, "sal005-produits");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.productId, qty: "10", unitPriceXof: 1500 },
    ]);
    const lineId = order.lineIds[0]!;

    await deliver(ids, order.orderId, [{ orderLineId: lineId, qty: "4" }]);

    const first = await draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "4" }]);
    expect(first.exTaxTotal).toBe(6000);
    const draftRow = await invoiceRow(first.invoiceId);
    expect(draftRow).toMatchObject({ status: "draft", number: null, exTaxTotal: 6000 });

    const firstNumber = await validateInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: first.invoiceId,
    });
    expect(firstNumber.number).toBe(`FAC-${YEAR}-0001`);

    let line = await orderLineRow(ids, lineId);
    expect(line.invoicedQty).toBe("4.000000");
    expect(line.invoicingState).toBe("partially_invoiced");
    let detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: order.orderId });
    expect(detail?.order.invoicingState).toBe("partially_invoiced");

    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]),
    ).rejects.toThrow("Ligne 1 : aucune quantité facturable restante.");

    await deliver(ids, order.orderId, [{ orderLineId: lineId, qty: "6" }]);
    const second = await issueInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "6" }]);
    expect(second.number).toBe(`FAC-${YEAR}-0002`);
    expect(second.exTaxTotal).toBe(9000);

    line = await orderLineRow(ids, lineId);
    expect(line.invoicedQty).toBe("10.000000");
    expect(line.invoicingState).toBe("invoiced");
    detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: order.orderId });
    expect(detail?.order.invoicingState).toBe("invoiced");

    const invoicesList = await listInvoices(db, ids.tenantId);
    expect(invoicesList.map((row) => row.number)).toEqual([`FAC-${YEAR}-0002`, `FAC-${YEAR}-0001`]);
  });

  it("facture les services sur la quantité commandée, sans livraison", async () => {
    const ids = await seedSalesTenant(db, "sal005-services");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "2", unitPriceXof: 75000 },
    ]);
    const lineId = order.lineIds[0]!;

    const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: order.orderId });
    expect(detail?.order.deliveryState).toBe("delivered");
    expect(detail?.lines[0]?.remainingToInvoice).toBe("2");

    const first = await issueInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]);
    expect(first.exTaxTotal).toBe(75000);
    expect((await orderLineRow(ids, lineId)).invoicingState).toBe("partially_invoiced");

    const second = await issueInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]);
    expect(second.number).toBe(`FAC-${YEAR}-0002`);
    expect((await orderLineRow(ids, lineId)).invoicingState).toBe("invoiced");

    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]),
    ).rejects.toThrow("Ligne 1 : aucune quantité facturable restante.");
  });

  it("refuse les dépassements, doublons, lignes étrangères, dates et notes invalides", async () => {
    const ids = await seedSalesTenant(db, "sal005-refus");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.productId, qty: "5", unitPriceXof: 1500 },
    ]);
    const other = await createConfirmedOrder(ids, [
      { articleId: ids.secondProductId, qty: "1", unitPriceXof: 700 },
    ]);
    const lineId = order.lineIds[0]!;

    await deliver(ids, order.orderId, [{ orderLineId: lineId, qty: "3" }]);

    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "4" }]),
    ).rejects.toThrow("Ligne 1 : quantité supérieure à la quantité facturable restante de 3.");
    await expect(
      draftInvoice(ids, order.orderId, [
        { orderLineId: lineId, qty: "1" },
        { orderLineId: lineId, qty: "1" },
      ]),
    ).rejects.toThrow("Une même ligne de commande apparaît deux fois dans la facture.");
    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: other.lineIds[0]!, qty: "1" }]),
    ).rejects.toThrow("Une ligne de facture n'appartient pas à cette commande.");
    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }], {
        invoiceDate: addDays(todayIsoDate(), 1),
        dueDate: addDays(todayIsoDate(), 2),
      }),
    ).rejects.toThrow("La date de facture ne peut pas être dans le futur.");
    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }], {
        invoiceDate: todayIsoDate(),
        dueDate: addDays(todayIsoDate(), -1),
      }),
    ).rejects.toThrow("L'échéance doit être postérieure ou égale à la date de facture.");
    await expect(
      draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }], {
        notes: "x".repeat(1001),
      }),
    ).rejects.toThrow("Notes : 1000 caractères maximum.");
    await expect(
      draftInvoice(ids, "00000000-0000-4000-8000-000000000000", [
        { orderLineId: lineId, qty: "1" },
      ]),
    ).rejects.toThrow("Commande client introuvable dans cet espace de travail.");

    expect(await listInvoices(db, ids.tenantId)).toHaveLength(0);
    expect((await orderLineRow(ids, lineId)).invoicedQty).toBe("0.000000");
  });

  it("valide une seule fois et fige le numéro et les montants", async () => {
    const ids = await seedSalesTenant(db, "sal005-figeage");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const lineId = order.lineIds[0]!;
    const draft = await draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]);
    const draftLines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, draft.invoiceId))
      .orderBy(asc(invoiceLines.lineNumber));

    const validated = await validateInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: draft.invoiceId,
    });
    expect(validated.number).toBe(`FAC-${YEAR}-0001`);

    await expect(
      validateInvoice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: draft.invoiceId,
      }),
    ).rejects.toThrow("Seule une facture brouillon peut être validée.");

    const frozen = await invoiceRow(draft.invoiceId);
    expect(frozen.status).toBe("validated");
    expect(frozen.number).toBe(validated.number);
    expect(frozen.exTaxTotal).toBe(75000);
    expect(frozen.validatedBy).toBe(ids.userId);
    expect(frozen.validatedAt).not.toBeNull();

    const frozenLines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, draft.invoiceId))
      .orderBy(asc(invoiceLines.lineNumber));
    expect(frozenLines).toEqual(draftLines);
    expect(frozenLines.map((line) => line.qty)).toEqual(["1.000000"]);
  });

  it("refuse la validation quand la commande a été annulée entre-temps", async () => {
    const ids = await seedSalesTenant(db, "sal005-annulation");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const lineId = order.lineIds[0]!;
    const draft = await draftInvoice(ids, order.orderId, [{ orderLineId: lineId, qty: "1" }]);

    await transitionSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.orderId,
      action: "cancel",
    });

    await expect(
      validateInvoice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: draft.invoiceId,
      }),
    ).rejects.toThrow("La commande n'est plus confirmée : la facture ne peut pas être validée.");

    const unchanged = await invoiceRow(draft.invoiceId);
    expect(unchanged.status).toBe("draft");
    expect(unchanged.number).toBeNull();
    expect((await orderLineRow(ids, lineId)).invoicedQty).toBe("0.000000");
  });
});

async function orderLinesOf(ids: SalesTenant, orderId: string): Promise<readonly string[]> {
  const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId });
  return detail?.lines.map((line) => line.id) ?? [];
}

describe("SAL-006 — règlements et encours", () => {
  it("refuse un règlement sur une facture brouillon", async () => {
    const ids = await seedSalesTenant(db, "sal006-brouillon");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const draft = await draftInvoice(ids, order.orderId, [
      { orderLineId: order.lineIds[0]!, qty: "1" },
    ]);

    await expect(
      createInvoicePayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: draft.invoiceId,
        amountXof: 1000,
        paidDate: todayIsoDate(),
        method: "transfer",
        reference: null,
      }),
    ).rejects.toThrow("Un règlement exige une facture validée.");

    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, draft.invoiceId));
    expect(payments).toHaveLength(0);
  });

  it("refuse les montants, dates, moyens et références invalides", async () => {
    const ids = await seedSalesTenant(db, "sal006-validation");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const invoice = await issueInvoice(ids, order.orderId, [
      { orderLineId: order.lineIds[0]!, qty: "1" },
    ]);

    const attempt = (overrides: Record<string, unknown>) =>
      createInvoicePayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: invoice.invoiceId,
        amountXof: 1000,
        paidDate: todayIsoDate(),
        method: "transfer",
        reference: null,
        ...overrides,
      });

    await expect(attempt({ amountXof: 0 })).rejects.toThrow(
      "Le montant du règlement doit être strictement positif.",
    );
    await expect(attempt({ amountXof: "12.5" })).rejects.toThrow(
      "Montant : montant XOF entier attendu, sans décimale.",
    );
    await expect(attempt({ amountXof: 75001 })).rejects.toThrow(
      /Montant supérieur au solde restant de/,
    );
    await expect(attempt({ paidDate: addDays(todayIsoDate(), 1) })).rejects.toThrow(
      "La date de règlement ne peut pas être dans le futur.",
    );
    await expect(attempt({ method: "crypto" })).rejects.toThrow(
      "Moyen de paiement inconnu : virement, espèces, chèque ou mobile money.",
    );
    await expect(attempt({ reference: "x".repeat(61) })).rejects.toThrow(
      "Référence du règlement : 60 caractères maximum.",
    );
    await expect(attempt({ invoiceId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
      "Facture introuvable dans cet espace de travail.",
    );

    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.invoiceId));
    expect(payments).toHaveLength(0);
  });

  it("encaisse des règlements partiels, solde la facture et les conserve", async () => {
    const ids = await seedSalesTenant(db, "sal006-reglements");
    const order = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const invoice = await issueInvoice(ids, order.orderId, [
      { orderLineId: order.lineIds[0]!, qty: "1" },
    ]);

    const first = await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: 25000,
      paidDate: addDays(todayIsoDate(), -1),
      method: "transfer",
      reference: "VIR-0001",
    });
    expect(first.balanceXof).toBe(50000);

    const second = await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: 50000,
      paidDate: todayIsoDate(),
      method: "mobile_money",
      reference: null,
    });
    expect(second.balanceXof).toBe(0);

    const detail = await getInvoice(db, { tenantId: ids.tenantId, invoiceId: invoice.invoiceId });
    expect(detail?.invoice.paidXof).toBe(75000);
    expect(detail?.invoice.balanceXof).toBe(0);
    expect(detail?.payments.map((payment) => payment.amountXof)).toEqual([25000, 50000]);
    expect(detail?.payments.map((payment) => payment.method)).toEqual(["transfer", "mobile_money"]);

    await expect(
      createInvoicePayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: invoice.invoiceId,
        amountXof: 1,
        paidDate: todayIsoDate(),
        method: "cash",
        reference: null,
      }),
    ).rejects.toThrow(/Montant supérieur au solde restant de/);

    const stored = await db
      .select({
        amountXof: invoicePayments.amountXof,
        paidDate: invoicePayments.paidDate,
        method: invoicePayments.method,
        reference: invoicePayments.reference,
      })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.invoiceId))
      .orderBy(asc(invoicePayments.createdAt));
    expect(stored).toEqual([
      {
        amountXof: 25000,
        paidDate: addDays(todayIsoDate(), -1),
        method: "transfer",
        reference: "VIR-0001",
      },
      { amountXof: 50000, paidDate: todayIsoDate(), method: "mobile_money", reference: null },
    ]);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "sales.invoice.payment"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("calcule l'encours sur les factures validées, en déduisant les règlements et l'échéance", async () => {
    const ids = await seedSalesTenant(db, "sal006-encours");

    const recentOrder = await createConfirmedOrder(ids, [
      { articleId: ids.productId, qty: "4", unitPriceXof: 1500 },
    ]);
    await deliver(ids, recentOrder.orderId, [{ orderLineId: recentOrder.lineIds[0]!, qty: "4" }]);
    const recent = await issueInvoice(
      ids,
      recentOrder.orderId,
      [{ orderLineId: recentOrder.lineIds[0]!, qty: "4" }],
      { dueDate: addDays(todayIsoDate(), 30) },
    );
    await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: recent.invoiceId,
      amountXof: 1000,
      paidDate: todayIsoDate(),
      method: "cash",
      reference: null,
    });

    const overdueOrder = await createConfirmedOrder(ids, [
      { articleId: ids.productId, qty: "2", unitPriceXof: 1500 },
    ]);
    await deliver(ids, overdueOrder.orderId, [{ orderLineId: overdueOrder.lineIds[0]!, qty: "2" }]);
    await issueInvoice(
      ids,
      overdueOrder.orderId,
      [{ orderLineId: overdueOrder.lineIds[0]!, qty: "2" }],
      {
        invoiceDate: addDays(todayIsoDate(), -40),
        dueDate: addDays(todayIsoDate(), -10),
      },
    );

    const draftOrder = await createConfirmedOrder(ids, [
      { articleId: ids.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    await draftInvoice(ids, draftOrder.orderId, [
      { orderLineId: draftOrder.lineIds[0]!, qty: "1" },
    ]);

    const stats = await getReceivablesStats(db, ids.tenantId);
    expect(stats).toEqual({
      outstandingXof: 8000,
      overdueXof: 3000,
      validatedCount: 2,
      draftCount: 1,
    });

    const rows = await listInvoices(db, ids.tenantId);
    expect(rows).toHaveLength(3);
    const paidRow = rows.find((row) => row.number === recent.number);
    expect(paidRow).toMatchObject({ paidXof: 1000, balanceXof: 5000, status: "validated" });
    const draftRow = rows.find((row) => row.status === "draft");
    expect(draftRow?.number).toBeNull();
    expect(draftRow?.balanceXof).toBe(75000);

    const detail = await getInvoice(db, {
      tenantId: ids.tenantId,
      invoiceId: recent.invoiceId,
    });
    expect(detail?.invoice.balanceXof).toBe(5000);
    expect(detail?.invoice.dueDate).toBe(addDays(todayIsoDate(), 30));
  });
});

describe("TEN — isolation des factures", () => {
  it("ne lit ni ne règle les factures d'un autre tenant", async () => {
    const first = await seedSalesTenant(db, "factures-ten-a");
    const second = await seedSalesTenant(db, "factures-ten-b");

    const order = await createConfirmedOrder(first, [
      { articleId: first.serviceId, qty: "1", unitPriceXof: 75000 },
    ]);
    const issued = await issueInvoice(first, order.orderId, [
      { orderLineId: order.lineIds[0]!, qty: "1" },
    ]);
    const pendingOrder = await createConfirmedOrder(first, [
      { articleId: first.serviceId, qty: "2", unitPriceXof: 75000 },
    ]);
    const draft = await draftInvoice(first, pendingOrder.orderId, [
      { orderLineId: pendingOrder.lineIds[0]!, qty: "1" },
    ]);

    expect(
      await getInvoice(db, { tenantId: second.tenantId, invoiceId: issued.invoiceId }),
    ).toBeNull();
    expect(await listInvoices(db, second.tenantId)).toHaveLength(0);
    expect(await getReceivablesStats(db, second.tenantId)).toEqual({
      outstandingXof: 0,
      overdueXof: 0,
      validatedCount: 0,
      draftCount: 0,
    });

    await expect(
      createInvoicePayment(db, {
        tenantId: second.tenantId,
        actorUserId: second.userId,
        invoiceId: issued.invoiceId,
        amountXof: 1000,
        paidDate: todayIsoDate(),
        method: "transfer",
        reference: null,
      }),
    ).rejects.toThrow("Facture introuvable dans cet espace de travail.");

    await expect(
      validateInvoice(db, {
        tenantId: second.tenantId,
        actorUserId: second.userId,
        invoiceId: draft.invoiceId,
      }),
    ).rejects.toThrow("Facture introuvable dans cet espace de travail.");

    await expect(
      draftInvoice(second, order.orderId, [{ orderLineId: order.lineIds[0]!, qty: "1" }]),
    ).rejects.toThrow("Commande client introuvable dans cet espace de travail.");

    const [firstStats, secondStats] = await Promise.all([
      getReceivablesStats(db, first.tenantId),
      getReceivablesStats(db, second.tenantId),
    ]);
    expect(firstStats.validatedCount).toBe(1);
    expect(firstStats.draftCount).toBe(1);
    expect(secondStats.validatedCount).toBe(0);

    const [foreignPayments] = await db
      .select({ value: count() })
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.tenantId, second.tenantId),
          eq(invoicePayments.invoiceId, issued.invoiceId),
        ),
      );
    expect(foreignPayments?.value).toBe(0);
  });
});

describe("Erreurs métier — factures", () => {
  it("refuse une facture introuvable avec SalesError", async () => {
    const ids = await seedSalesTenant(db, "factures-erreurs");
    await expect(
      validateInvoice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toBeInstanceOf(SalesError);
  });
});
