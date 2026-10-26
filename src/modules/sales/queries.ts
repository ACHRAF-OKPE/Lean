import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  deliveries,
  invoiceLines,
  invoicePayments,
  invoices,
  partners,
  salesOrderLines,
  salesOrders,
  stockLocations,
  stockMoves,
  type ArticleType,
  type DeliveryState,
  type DeliveryStatus,
  type InvoiceStatus,
  type InvoicingState,
  type PaymentMethod,
  type SalesOrderStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { normalizeQuantity, remainingQuantity } from "@/modules/stock/quantities";
import { SalesError } from "./errors";
import {
  canApplySalesAction,
  computeOrderDeliveryState,
  salesActionLabel,
  salesStatusLabel,
  type SalesAction,
} from "./lifecycle";
import {
  validateDraftSalesOrder,
  type CustomerReference,
  type DraftSalesOrderInput,
  type SalesArticleReference,
} from "./validation";

export interface CustomerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface SalesArticleOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly salePriceXof: number;
}

export interface SalesOrderSummary {
  readonly id: string;
  readonly number: string | null;
  readonly status: SalesOrderStatus;
  readonly deliveryState: DeliveryState;
  readonly invoicingState: InvoicingState;
  readonly orderDate: string;
  readonly expectedDeliveryDate: string | null;
  readonly customerCode: string;
  readonly customerName: string;
  readonly exTaxTotal: number;
  readonly createdAt: Date;
}

export interface SalesOrderLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly articleType: ArticleType;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
  readonly deliveredQty: string;
  readonly deliveryState: DeliveryState;
  readonly invoicedQty: string;
  readonly invoicingState: InvoicingState;
  readonly remainingToDeliver: string;
  readonly remainingToInvoice: string;
}

export interface DeliverySummary {
  readonly id: string;
  readonly number: string;
  readonly status: DeliveryStatus;
  readonly deliveredDate: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly notes: string | null;
  readonly moveNumber: string | null;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
}

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly exTaxTotal: number;
  readonly paidXof: number;
  readonly balanceXof: number;
  readonly createdAt: Date;
  readonly validatedAt: Date | null;
  readonly cancelledAt: Date | null;
}

export interface SalesOrderDetail {
  readonly order: SalesOrderSummary & {
    readonly customerId: string;
    readonly externalReference: string | null;
    readonly incoterm: string | null;
    readonly notes: string | null;
    readonly confirmedAt: Date | null;
  };
  readonly lines: readonly SalesOrderLineDetail[];
  readonly deliveries: readonly DeliverySummary[];
  readonly invoices: readonly InvoiceSummary[];
  readonly hasValidatedDelivery: boolean;
  readonly hasValidatedInvoice: boolean;
}

export interface SalesOrderStats {
  readonly open: number;
  readonly awaitingDelivery: number;
  readonly toInvoice: number;
}

export interface ReceivablesStats {
  readonly outstandingXof: number;
  readonly overdueXof: number;
  readonly validatedCount: number;
  readonly draftCount: number;
}

export interface InvoiceListRow {
  readonly id: string;
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly customerCode: string;
  readonly customerName: string;
  readonly exTaxTotal: number;
  readonly paidXof: number;
  readonly balanceXof: number;
  readonly createdAt: Date;
  readonly validatedAt: Date | null;
}

export interface InvoiceLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly orderLineId: string;
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface PaymentDetail {
  readonly id: string;
  readonly amountXof: number;
  readonly paidDate: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly createdAt: Date;
}

export interface InvoiceDetail {
  readonly invoice: InvoiceListRow & {
    readonly customerId: string;
    readonly notes: string | null;
  };
  readonly lines: readonly InvoiceLineDetail[];
  readonly payments: readonly PaymentDetail[];
}

export async function getCustomerOptions(
  db: Database,
  tenantId: string,
): Promise<readonly CustomerOption[]> {
  return db
    .select({ id: partners.id, code: partners.code, name: partners.name })
    .from(partners)
    .where(
      and(
        eq(partners.tenantId, tenantId),
        eq(partners.isCustomer, true),
        eq(partners.active, true),
      ),
    )
    .orderBy(asc(partners.name))
    .limit(500);
}

export async function getSalesArticleOptions(
  db: Database,
  tenantId: string,
): Promise<readonly SalesArticleOption[]> {
  return db
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      type: articles.type,
      unitCode: articles.unitCode,
      salePriceXof: articles.salePriceXof,
    })
    .from(articles)
    .where(
      and(
        eq(articles.tenantId, tenantId),
        eq(articles.isSellable, true),
        eq(articles.active, true),
      ),
    )
    .orderBy(asc(articles.name))
    .limit(500);
}

async function loadSalesOrderReferences(
  db: Database,
  tenantId: string,
  input: { customerId: string; articleIds: readonly string[] },
): Promise<{
  customer: CustomerReference | null;
  articlesById: Map<string, SalesArticleReference>;
}> {
  const [customer] = await db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      active: partners.active,
      isCustomer: partners.isCustomer,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, input.customerId)))
    .limit(1);

  const articleRows =
    input.articleIds.length === 0
      ? []
      : await db
          .select({
            id: articles.id,
            code: articles.code,
            name: articles.name,
            type: articles.type,
            unitCode: articles.unitCode,
            active: articles.active,
            isSellable: articles.isSellable,
            salePriceXof: articles.salePriceXof,
          })
          .from(articles)
          .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, [...input.articleIds])));

  return {
    customer: customer ?? null,
    articlesById: new Map(articleRows.map((row) => [row.id, row])),
  };
}

export async function listSalesOrders(
  db: Database,
  tenantId: string,
): Promise<readonly SalesOrderSummary[]> {
  return db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      deliveryState: salesOrders.deliveryState,
      invoicingState: salesOrders.invoicingState,
      orderDate: salesOrders.orderDate,
      expectedDeliveryDate: salesOrders.expectedDeliveryDate,
      customerCode: partners.code,
      customerName: partners.name,
      exTaxTotal: salesOrders.exTaxTotal,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .innerJoin(
      partners,
      and(eq(partners.tenantId, salesOrders.tenantId), eq(partners.id, salesOrders.customerId)),
    )
    .where(eq(salesOrders.tenantId, tenantId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(200);
}

export async function getSalesOrderStats(db: Database, tenantId: string): Promise<SalesOrderStats> {
  const rows = await db
    .select({
      status: salesOrders.status,
      deliveryState: salesOrders.deliveryState,
      invoicingState: salesOrders.invoicingState,
    })
    .from(salesOrders)
    .where(eq(salesOrders.tenantId, tenantId));

  return {
    open: rows.filter((row) => row.status !== "closed" && row.status !== "cancelled").length,
    awaitingDelivery: rows.filter(
      (row) => row.status === "confirmed" && row.deliveryState !== "delivered",
    ).length,
    toInvoice: rows.filter((row) => row.status === "confirmed" && row.invoicingState !== "invoiced")
      .length,
  };
}

async function paidByInvoice(
  db: Database,
  tenantId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      invoiceId: invoicePayments.invoiceId,
      paid: sql<string>`sum(${invoicePayments.amountXof})`,
    })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.tenantId, tenantId),
        inArray(invoicePayments.invoiceId, [...invoiceIds]),
      ),
    )
    .groupBy(invoicePayments.invoiceId);
  return new Map(rows.map((row) => [row.invoiceId, Number(row.paid ?? 0)]));
}

export async function getSalesOrder(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<SalesOrderDetail | null> {
  const [order] = await db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      deliveryState: salesOrders.deliveryState,
      invoicingState: salesOrders.invoicingState,
      orderDate: salesOrders.orderDate,
      expectedDeliveryDate: salesOrders.expectedDeliveryDate,
      customerId: salesOrders.customerId,
      customerCode: partners.code,
      customerName: partners.name,
      externalReference: salesOrders.externalReference,
      incoterm: salesOrders.incoterm,
      notes: salesOrders.notes,
      exTaxTotal: salesOrders.exTaxTotal,
      confirmedAt: salesOrders.confirmedAt,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .innerJoin(
      partners,
      and(eq(partners.tenantId, salesOrders.tenantId), eq(partners.id, salesOrders.customerId)),
    )
    .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, input.orderId)))
    .limit(1);

  if (!order) {
    return null;
  }

  const lineRows = await db
    .select({
      id: salesOrderLines.id,
      lineNumber: salesOrderLines.lineNumber,
      articleId: salesOrderLines.articleId,
      articleCode: articles.code,
      articleName: articles.name,
      articleType: articles.type,
      unitCode: salesOrderLines.unitCode,
      qty: salesOrderLines.qty,
      unitPriceXof: salesOrderLines.unitPriceXof,
      lineTotalXof: salesOrderLines.lineTotalXof,
      deliveredQty: salesOrderLines.deliveredQty,
      deliveryState: salesOrderLines.deliveryState,
      invoicedQty: salesOrderLines.invoicedQty,
      invoicingState: salesOrderLines.invoicingState,
    })
    .from(salesOrderLines)
    .innerJoin(
      articles,
      and(
        eq(articles.tenantId, salesOrderLines.tenantId),
        eq(articles.id, salesOrderLines.articleId),
      ),
    )
    .where(
      and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.orderId, input.orderId)),
    )
    .orderBy(asc(salesOrderLines.lineNumber));

  const deliveryRows = await db
    .select({
      id: deliveries.id,
      number: deliveries.number,
      status: deliveries.status,
      deliveredDate: deliveries.deliveredDate,
      locationCode: stockLocations.code,
      locationName: stockLocations.name,
      notes: deliveries.notes,
      moveNumber: stockMoves.number,
      createdAt: deliveries.createdAt,
      cancelledAt: deliveries.cancelledAt,
    })
    .from(deliveries)
    .innerJoin(
      stockLocations,
      and(
        eq(stockLocations.tenantId, deliveries.tenantId),
        eq(stockLocations.id, deliveries.locationId),
      ),
    )
    .leftJoin(
      stockMoves,
      and(
        eq(stockMoves.tenantId, deliveries.tenantId),
        eq(stockMoves.deliveryId, deliveries.id),
        eq(stockMoves.type, "outgoing"),
      ),
    )
    .where(and(eq(deliveries.tenantId, input.tenantId), eq(deliveries.orderId, input.orderId)))
    .orderBy(desc(deliveries.createdAt));

  const invoiceRows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      exTaxTotal: invoices.exTaxTotal,
      createdAt: invoices.createdAt,
      validatedAt: invoices.validatedAt,
      cancelledAt: invoices.cancelledAt,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.orderId, input.orderId)))
    .orderBy(desc(invoices.createdAt));

  const paid = await paidByInvoice(
    db,
    input.tenantId,
    invoiceRows.map((row) => row.id),
  );

  const lines: SalesOrderLineDetail[] = lineRows.map((line) => {
    const qty = normalizeQuantity(line.qty);
    const deliveredQty = normalizeQuantity(line.deliveredQty);
    const invoicedQty = normalizeQuantity(line.invoicedQty);
    const billableBase = line.articleType === "product" ? deliveredQty : qty;
    return {
      ...line,
      qty,
      deliveredQty,
      invoicedQty,
      remainingToDeliver: remainingQuantity(qty, deliveredQty),
      remainingToInvoice: remainingQuantity(billableBase, invoicedQty),
    };
  });

  const invoiceSummaries: InvoiceSummary[] = invoiceRows.map((row) => {
    const paidXof = paid.get(row.id) ?? 0;
    return {
      ...row,
      paidXof,
      balanceXof: row.exTaxTotal - paidXof,
    };
  });

  return {
    order,
    lines,
    deliveries: deliveryRows,
    invoices: invoiceSummaries,
    hasValidatedDelivery: deliveryRows.some((row) => row.status === "validated"),
    hasValidatedInvoice: invoiceRows.some((row) => row.status === "validated"),
  };
}

export interface CreateSalesOrderResult {
  readonly id: string;
  readonly warnings: readonly string[];
}

export async function createSalesOrder(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    data: DraftSalesOrderInput;
  },
): Promise<CreateSalesOrderResult> {
  const articleIds = [...new Set(input.data.lines.map((line) => line.articleId))];
  const references = await loadSalesOrderReferences(db, input.tenantId, {
    customerId: input.data.customerId,
    articleIds,
  });
  const validation = validateDraftSalesOrder(input.data, {
    today: todayIsoDate(),
    customer: references.customer,
    articlesById: references.articlesById,
  });

  if (!validation.order) {
    throw new SalesError(
      validation.errors.length > 0
        ? validation.errors.join("\n")
        : "La commande n'a pas pu être validée.",
    );
  }
  const order = validation.order;
  const initialDeliveryState = computeOrderDeliveryState(
    order.lines.map((line) => ({
      type: references.articlesById.get(line.articleId)?.type ?? "service",
      deliveryState: "not_delivered" as const,
    })),
  );

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(salesOrders)
      .values({
        tenantId: input.tenantId,
        customerId: order.customer.id,
        status: "draft",
        deliveryState: initialDeliveryState,
        invoicingState: "not_invoiced",
        orderDate: order.orderDate,
        expectedDeliveryDate: order.expectedDeliveryDate,
        externalReference: order.externalReference,
        incoterm: order.incoterm,
        notes: order.notes,
        exTaxTotal: order.exTaxTotal,
        createdBy: input.actorUserId,
      })
      .returning({ id: salesOrders.id });

    if (!created) {
      throw new SalesError("La commande n'a pas pu être créée.");
    }

    await tx.insert(salesOrderLines).values(
      order.lines.map((line, index) => ({
        tenantId: input.tenantId,
        orderId: created.id,
        lineNumber: index + 1,
        articleId: line.articleId,
        name: line.name,
        unitCode: line.unitCode,
        qty: line.qty,
        unitPriceXof: line.unitPriceXof,
        lineTotalXof: line.lineTotalXof,
        deliveredQty: "0",
        invoicedQty: "0",
        deliveryState: "not_delivered" as const,
        invoicingState: "not_invoiced" as const,
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.order.create",
      entityType: "sales_order",
      entityId: created.id,
      details: {
        customerCode: order.customer.code,
        lineCount: order.lines.length,
        incoterm: order.incoterm,
        exTaxTotal: order.exTaxTotal,
      },
    });

    return { id: created.id, warnings: validation.order?.warnings ?? [] };
  });
}

export interface TransitionSalesOrderInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly orderId: string;
  readonly action: SalesAction;
}

export interface TransitionSalesOrderResult {
  readonly id: string;
  readonly number: string | null;
  readonly status: SalesOrderStatus;
}

export async function transitionSalesOrder(
  db: Database,
  input: TransitionSalesOrderInput,
): Promise<TransitionSalesOrderResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, input.orderId)))
      .limit(1)
      .for("update");

    if (!order) {
      throw new SalesError("Commande client introuvable dans cet espace de travail.");
    }
    if (!canApplySalesAction(order.status, input.action)) {
      throw new SalesError(
        `Action impossible : une commande ${salesStatusLabel(order.status).toLowerCase()} ne peut pas être ${salesActionLabel(input.action)}.`,
      );
    }

    if (input.action === "cancel") {
      const [validatedDelivery] = await tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tenantId, input.tenantId),
            eq(deliveries.orderId, order.id),
            eq(deliveries.status, "validated"),
          ),
        )
        .limit(1);
      if (validatedDelivery) {
        throw new SalesError(
          "Une livraison validée existe : annulez d'abord la livraison avant d'annuler la commande.",
        );
      }
      const [validatedInvoice] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, input.tenantId),
            eq(invoices.orderId, order.id),
            eq(invoices.status, "validated"),
          ),
        )
        .limit(1);
      if (validatedInvoice) {
        throw new SalesError("Une facture validée existe : la commande ne peut plus être annulée.");
      }
    }

    const statusByAction: Record<Exclude<SalesAction, "cancel">, SalesOrderStatus> = {
      confirm: "confirmed",
      close: "closed",
    };
    const nextStatus: SalesOrderStatus =
      input.action === "cancel" ? "cancelled" : statusByAction[input.action];

    let number = order.number;
    if (input.action === "confirm") {
      number = await nextDocumentNumber(tx, {
        tenantId: input.tenantId,
        scope: "sales_order",
      });
    }

    await tx
      .update(salesOrders)
      .set({
        status: nextStatus,
        number,
        confirmedBy: input.action === "confirm" ? input.actorUserId : order.confirmedBy,
        confirmedAt: input.action === "confirm" ? new Date() : order.confirmedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, order.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: `sales.order.${input.action}`,
      entityType: "sales_order",
      entityId: order.id,
      details: {
        from: order.status,
        to: nextStatus,
        number,
      },
    });

    return { id: order.id, number, status: nextStatus };
  });
}

export function canCancelSalesOrder(status: SalesOrderStatus): boolean {
  return canApplySalesAction(status, "cancel");
}

export async function listInvoices(
  db: Database,
  tenantId: string,
): Promise<readonly InvoiceListRow[]> {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      orderId: invoices.orderId,
      orderNumber: salesOrders.number,
      customerCode: partners.code,
      customerName: partners.name,
      exTaxTotal: invoices.exTaxTotal,
      createdAt: invoices.createdAt,
      validatedAt: invoices.validatedAt,
    })
    .from(invoices)
    .innerJoin(
      partners,
      and(eq(partners.tenantId, invoices.tenantId), eq(partners.id, invoices.customerId)),
    )
    .innerJoin(
      salesOrders,
      and(eq(salesOrders.tenantId, invoices.tenantId), eq(salesOrders.id, invoices.orderId)),
    )
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt))
    .limit(200);

  const paid = await paidByInvoice(
    db,
    tenantId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const paidXof = paid.get(row.id) ?? 0;
    return { ...row, paidXof, balanceXof: row.exTaxTotal - paidXof };
  });
}

export async function getInvoice(
  db: Database,
  input: { tenantId: string; invoiceId: string },
): Promise<InvoiceDetail | null> {
  const [invoice] = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      orderId: invoices.orderId,
      orderNumber: salesOrders.number,
      customerId: invoices.customerId,
      customerCode: partners.code,
      customerName: partners.name,
      notes: invoices.notes,
      exTaxTotal: invoices.exTaxTotal,
      createdAt: invoices.createdAt,
      validatedAt: invoices.validatedAt,
    })
    .from(invoices)
    .innerJoin(
      partners,
      and(eq(partners.tenantId, invoices.tenantId), eq(partners.id, invoices.customerId)),
    )
    .innerJoin(
      salesOrders,
      and(eq(salesOrders.tenantId, invoices.tenantId), eq(salesOrders.id, invoices.orderId)),
    )
    .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)))
    .limit(1);

  if (!invoice) {
    return null;
  }

  const lineRows = await db
    .select({
      id: invoiceLines.id,
      lineNumber: invoiceLines.lineNumber,
      orderLineId: invoiceLines.orderLineId,
      articleId: invoiceLines.articleId,
      articleCode: articles.code,
      articleName: articles.name,
      unitCode: invoiceLines.unitCode,
      qty: invoiceLines.qty,
      unitPriceXof: invoiceLines.unitPriceXof,
      lineTotalXof: invoiceLines.lineTotalXof,
    })
    .from(invoiceLines)
    .innerJoin(
      articles,
      and(eq(articles.tenantId, invoiceLines.tenantId), eq(articles.id, invoiceLines.articleId)),
    )
    .where(
      and(eq(invoiceLines.tenantId, input.tenantId), eq(invoiceLines.invoiceId, input.invoiceId)),
    )
    .orderBy(asc(invoiceLines.lineNumber));

  const paymentRows = await db
    .select({
      id: invoicePayments.id,
      amountXof: invoicePayments.amountXof,
      paidDate: invoicePayments.paidDate,
      method: invoicePayments.method,
      reference: invoicePayments.reference,
      createdAt: invoicePayments.createdAt,
    })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.tenantId, input.tenantId),
        eq(invoicePayments.invoiceId, input.invoiceId),
      ),
    )
    .orderBy(asc(invoicePayments.paidDate), asc(invoicePayments.createdAt));

  const paidXof = paymentRows.reduce((sum, payment) => sum + payment.amountXof, 0);

  return {
    invoice: {
      ...invoice,
      paidXof,
      balanceXof: invoice.exTaxTotal - paidXof,
    },
    lines: lineRows.map((line) => ({ ...line, qty: normalizeQuantity(line.qty) })),
    payments: paymentRows,
  };
}

export async function getReceivablesStats(
  db: Database,
  tenantId: string,
  today = todayIsoDate(),
): Promise<ReceivablesStats> {
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      dueDate: invoices.dueDate,
      exTaxTotal: invoices.exTaxTotal,
    })
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId));

  const validated = rows.filter((row) => row.status === "validated");
  const paid = await paidByInvoice(
    db,
    tenantId,
    validated.map((row) => row.id),
  );

  let outstandingXof = 0;
  let overdueXof = 0;
  for (const row of validated) {
    const balance = row.exTaxTotal - (paid.get(row.id) ?? 0);
    if (balance <= 0) {
      continue;
    }
    outstandingXof += balance;
    if (row.dueDate < today) {
      overdueXof += balance;
    }
  }

  return {
    outstandingXof,
    overdueXof,
    validatedCount: validated.length,
    draftCount: rows.filter((row) => row.status === "draft").length,
  };
}
