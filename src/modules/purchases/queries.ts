import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  receptions,
  stockLocations,
  stockMoves,
  type ArticleType,
  type PurchaseOrderStatus,
  type ReceiptState,
  type ReceptionStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { recordDocumentEvent } from "@/modules/discussion/queries";
import type { DocumentEventType } from "@/modules/discussion/events";
import {
  actionLabel,
  canApplyAction,
  computeOrderReceiptState,
  statusLabel,
  type PurchaseAction,
} from "./lifecycle";
import { PurchaseError } from "./errors";
import {
  validateDraftOrder,
  type ArticleReference,
  type DraftOrderInput,
  type SupplierReference,
} from "./validation";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { normalizeQuantity, remainingQuantity } from "@/modules/stock/quantities";

const PURCHASE_EVENT_BY_ACTION: Record<PurchaseAction, DocumentEventType> = {
  request: "purchase_order.requested",
  confirm: "purchase_order.confirmed",
  close: "purchase_order.closed",
  cancel: "purchase_order.cancelled",
};

export interface SupplierOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ArticleOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly purchasePriceXof: number;
}

export interface PurchaseOrderSummary {
  readonly id: string;
  readonly number: string | null;
  readonly status: PurchaseOrderStatus;
  readonly receiptState: ReceiptState;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly exTaxTotal: number;
  readonly createdAt: Date;
}

export interface PurchaseOrderLineDetail {
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
  readonly receivedQty: string;
  readonly receiptState: ReceiptState;
  readonly remainingQty: string;
}

export interface ReceptionSummary {
  readonly id: string;
  readonly number: string;
  readonly status: ReceptionStatus;
  readonly receivedDate: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly notes: string | null;
  readonly moveNumber: string | null;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
}

export interface PurchaseOrderDetail {
  readonly order: PurchaseOrderSummary & {
    readonly supplierId: string;
    readonly externalReference: string | null;
    readonly notes: string | null;
    readonly confirmedAt: Date | null;
  };
  readonly lines: readonly PurchaseOrderLineDetail[];
  readonly receptions: readonly ReceptionSummary[];
  readonly hasValidatedReception: boolean;
}

export interface PurchaseOrderStats {
  readonly open: number;
  readonly awaitingReceipt: number;
}

export async function getSupplierOptions(
  db: Database,
  tenantId: string,
): Promise<readonly SupplierOption[]> {
  return db
    .select({ id: partners.id, code: partners.code, name: partners.name })
    .from(partners)
    .where(
      and(
        eq(partners.tenantId, tenantId),
        eq(partners.isSupplier, true),
        eq(partners.active, true),
      ),
    )
    .orderBy(asc(partners.name))
    .limit(500);
}

export async function getArticleOptions(
  db: Database,
  tenantId: string,
): Promise<readonly ArticleOption[]> {
  return db
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      type: articles.type,
      unitCode: articles.unitCode,
      purchasePriceXof: articles.purchasePriceXof,
    })
    .from(articles)
    .where(
      and(
        eq(articles.tenantId, tenantId),
        eq(articles.isPurchasable, true),
        eq(articles.active, true),
      ),
    )
    .orderBy(asc(articles.name))
    .limit(500);
}

async function loadOrderReferences(
  db: Database,
  tenantId: string,
  input: { supplierId: string; articleIds: readonly string[] },
): Promise<{
  supplier: SupplierReference | null;
  articlesById: Map<string, ArticleReference>;
}> {
  const [supplier] = await db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      active: partners.active,
      isSupplier: partners.isSupplier,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, input.supplierId)))
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
            isPurchasable: articles.isPurchasable,
            purchasePriceXof: articles.purchasePriceXof,
          })
          .from(articles)
          .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, [...input.articleIds])));

  return {
    supplier: supplier ?? null,
    articlesById: new Map(articleRows.map((row) => [row.id, row])),
  };
}

export async function listPurchaseOrders(
  db: Database,
  tenantId: string,
): Promise<readonly PurchaseOrderSummary[]> {
  return db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      receiptState: purchaseOrders.receiptState,
      orderDate: purchaseOrders.orderDate,
      expectedReceiptDate: purchaseOrders.expectedReceiptDate,
      supplierCode: partners.code,
      supplierName: partners.name,
      exTaxTotal: purchaseOrders.exTaxTotal,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .where(eq(purchaseOrders.tenantId, tenantId))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(200);
}

export async function getPurchaseOrderStats(
  db: Database,
  tenantId: string,
): Promise<PurchaseOrderStats> {
  const rows = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.tenantId, tenantId));

  return {
    open: rows.filter((row) => row.status !== "closed" && row.status !== "cancelled").length,
    awaitingReceipt: rows.filter((row) => row.status === "confirmed").length,
  };
}

export async function getPurchaseOrder(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<PurchaseOrderDetail | null> {
  const [order] = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      receiptState: purchaseOrders.receiptState,
      orderDate: purchaseOrders.orderDate,
      expectedReceiptDate: purchaseOrders.expectedReceiptDate,
      supplierId: purchaseOrders.supplierId,
      supplierCode: partners.code,
      supplierName: partners.name,
      externalReference: purchaseOrders.externalReference,
      notes: purchaseOrders.notes,
      exTaxTotal: purchaseOrders.exTaxTotal,
      confirmedAt: purchaseOrders.confirmedAt,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
    .limit(1);

  if (!order) {
    return null;
  }

  const lineRows = await db
    .select({
      id: purchaseOrderLines.id,
      lineNumber: purchaseOrderLines.lineNumber,
      articleId: purchaseOrderLines.articleId,
      articleCode: articles.code,
      articleName: articles.name,
      articleType: articles.type,
      unitCode: purchaseOrderLines.unitCode,
      qty: purchaseOrderLines.qty,
      unitPriceXof: purchaseOrderLines.unitPriceXof,
      lineTotalXof: purchaseOrderLines.lineTotalXof,
      receivedQty: purchaseOrderLines.receivedQty,
      receiptState: purchaseOrderLines.receiptState,
    })
    .from(purchaseOrderLines)
    .innerJoin(
      articles,
      and(
        eq(articles.tenantId, purchaseOrderLines.tenantId),
        eq(articles.id, purchaseOrderLines.articleId),
      ),
    )
    .where(
      and(
        eq(purchaseOrderLines.tenantId, input.tenantId),
        eq(purchaseOrderLines.orderId, input.orderId),
      ),
    )
    .orderBy(asc(purchaseOrderLines.lineNumber));

  const receptionRows = await db
    .select({
      id: receptions.id,
      number: receptions.number,
      status: receptions.status,
      receivedDate: receptions.receivedDate,
      locationCode: stockLocations.code,
      locationName: stockLocations.name,
      notes: receptions.notes,
      moveNumber: stockMoves.number,
      createdAt: receptions.createdAt,
      cancelledAt: receptions.cancelledAt,
    })
    .from(receptions)
    .innerJoin(
      stockLocations,
      and(
        eq(stockLocations.tenantId, receptions.tenantId),
        eq(stockLocations.id, receptions.locationId),
      ),
    )
    .leftJoin(
      stockMoves,
      and(
        eq(stockMoves.tenantId, receptions.tenantId),
        eq(stockMoves.receptionId, receptions.id),
        eq(stockMoves.type, "incoming"),
      ),
    )
    .where(and(eq(receptions.tenantId, input.tenantId), eq(receptions.orderId, input.orderId)))
    .orderBy(desc(receptions.createdAt));

  const lines: PurchaseOrderLineDetail[] = lineRows.map((line) => {
    const qty = normalizeQuantity(line.qty);
    const receivedQty = normalizeQuantity(line.receivedQty);
    return {
      ...line,
      qty,
      receivedQty,
      remainingQty: remainingQuantity(qty, receivedQty),
    };
  });

  return {
    order,
    lines,
    receptions: receptionRows,
    hasValidatedReception: receptionRows.some((row) => row.status === "validated"),
  };
}

export interface CreatePurchaseOrderResult {
  readonly id: string;
  readonly warnings: readonly string[];
}

export async function createPurchaseOrder(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    data: DraftOrderInput;
  },
): Promise<CreatePurchaseOrderResult> {
  const articleIds = [...new Set(input.data.lines.map((line) => line.articleId))];
  const references = await loadOrderReferences(db, input.tenantId, {
    supplierId: input.data.supplierId,
    articleIds,
  });
  const validation = validateDraftOrder(input.data, {
    today: todayIsoDate(),
    supplier: references.supplier,
    articlesById: references.articlesById,
  });

  if (!validation.order) {
    throw new PurchaseError(
      validation.errors.length > 0
        ? validation.errors.join("\n")
        : "La commande n'a pas pu être validée.",
    );
  }
  const order = validation.order;
  const initialReceiptState = computeOrderReceiptState(
    order.lines.map((line) => ({
      type: references.articlesById.get(line.articleId)?.type ?? "service",
      receiptState: "not_received" as const,
    })),
  );

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: input.tenantId,
        supplierId: order.supplier.id,
        status: "draft",
        receiptState: initialReceiptState,
        orderDate: order.orderDate,
        expectedReceiptDate: order.expectedReceiptDate,
        externalReference: order.externalReference,
        notes: order.notes,
        exTaxTotal: order.exTaxTotal,
        createdBy: input.actorUserId,
      })
      .returning({ id: purchaseOrders.id });

    if (!created) {
      throw new PurchaseError("La commande n'a pas pu être créée.");
    }

    await tx.insert(purchaseOrderLines).values(
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
        receivedQty: "0",
        receiptState: "not_received" as const,
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.order.create",
      entityType: "purchase_order",
      entityId: created.id,
      details: {
        supplierCode: order.supplier.code,
        lineCount: order.lines.length,
        exTaxTotal: order.exTaxTotal,
      },
    });

    return { id: created.id, warnings: validation.order?.warnings ?? [] };
  });
}

export interface TransitionPurchaseOrderInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly orderId: string;
  readonly action: PurchaseAction;
}

export interface TransitionResult {
  readonly id: string;
  readonly number: string | null;
  readonly status: PurchaseOrderStatus;
}

export async function transitionPurchaseOrder(
  db: Database,
  input: TransitionPurchaseOrderInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .limit(1)
      .for("update");

    if (!order) {
      throw new PurchaseError("Commande introuvable dans cet espace de travail.");
    }
    if (!canApplyAction(order.status, input.action)) {
      throw new PurchaseError(
        `Action impossible : une commande ${statusLabel(order.status).toLowerCase()} ne peut pas être ${actionLabel(input.action)}.`,
      );
    }

    if (input.action === "cancel") {
      const [validated] = await tx
        .select({ id: receptions.id })
        .from(receptions)
        .where(
          and(
            eq(receptions.tenantId, input.tenantId),
            eq(receptions.orderId, order.id),
            eq(receptions.status, "validated"),
          ),
        )
        .limit(1);
      if (validated) {
        throw new PurchaseError(
          "Une réception validée existe : annulez d'abord la réception avant d'annuler la commande.",
        );
      }
    }

    const statusByAction: Record<Exclude<PurchaseAction, "cancel">, PurchaseOrderStatus> = {
      request: "requested",
      confirm: "confirmed",
      close: "closed",
    };
    const nextStatus: PurchaseOrderStatus =
      input.action === "cancel" ? "cancelled" : statusByAction[input.action];

    let number = order.number;
    if (input.action === "confirm") {
      number = await nextDocumentNumber(tx, {
        tenantId: input.tenantId,
        scope: "purchase_order",
      });
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: nextStatus,
        number,
        confirmedBy: input.action === "confirm" ? input.actorUserId : order.confirmedBy,
        confirmedAt: input.action === "confirm" ? new Date() : order.confirmedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, order.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: `purchase.order.${input.action}`,
      entityType: "purchase_order",
      entityId: order.id,
      details: {
        from: order.status,
        to: nextStatus,
        number,
      },
    });

    await recordDocumentEvent(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "purchase_order",
      entityId: order.id,
      event: {
        type: PURCHASE_EVENT_BY_ACTION[input.action],
        key: `status:${input.action}`,
        number,
      },
    });

    return { id: order.id, number, status: nextStatus };
  });
}

export function canReceive(status: PurchaseOrderStatus): boolean {
  return status === "confirmed";
}

export function canCancelOrder(status: PurchaseOrderStatus): boolean {
  return canApplyAction(status, "cancel");
}
