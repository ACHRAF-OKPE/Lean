import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  deliveryLines,
  deliveries,
  salesOrderLines,
  salesOrders,
  stockLocations,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import type { DeliveryState } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  addQuantity,
  compareQuantity,
  formatQuantity,
  parseQuantity,
  subtractQuantity,
} from "@/modules/stock/quantities";
import { ensureDefaultLocations } from "@/modules/stock/locations";
import { insertStockMove } from "@/modules/stock/moves";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { SalesError } from "./errors";
import { computeLineDeliveryState, computeOrderDeliveryState } from "./lifecycle";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DeliveryLineInput {
  readonly orderLineId: string;
  readonly qty: unknown;
}

export interface CreateDeliveryInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly orderId: string;
  readonly locationId: string;
  readonly deliveredDate: unknown;
  readonly notes: unknown;
  readonly lines: readonly DeliveryLineInput[];
}

export interface CreateDeliveryResult {
  readonly deliveryId: string;
  readonly number: string;
  readonly moveNumber: string;
}

export interface CancelDeliveryInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly deliveryId: string;
  readonly notes?: unknown;
}

export interface CancelDeliveryResult {
  readonly number: string;
  readonly moveNumber: string;
}

function parseNotes(raw: unknown): string | null {
  const notes = raw === null || raw === undefined ? "" : String(raw).trim();
  if (notes.length > 1000) {
    throw new SalesError("Notes : 1000 caractères maximum.");
  }
  return notes || null;
}

async function articleTypes(
  tx: Transaction,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, "product" | "service">> {
  if (articleIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ id: articles.id, type: articles.type })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, [...articleIds])));
  return new Map(rows.map((row) => [row.id, row.type]));
}

export async function createDelivery(
  db: Database,
  input: CreateDeliveryInput,
): Promise<CreateDeliveryResult> {
  return db.transaction(async (tx) => {
    const date = parseIsoDate(input.deliveredDate, "Date de livraison", true);
    if (!date.value) {
      throw new SalesError(date.errors.join("\n"));
    }
    if (date.value > todayIsoDate()) {
      throw new SalesError("La date de livraison ne peut pas être dans le futur.");
    }
    const notes = parseNotes(input.notes);

    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, input.orderId)))
      .limit(1)
      .for("update");

    if (!order) {
      throw new SalesError("Commande client introuvable dans cet espace de travail.");
    }
    if (order.status !== "confirmed") {
      throw new SalesError(
        "Une livraison exige une commande confirmée. Confirmez la commande au préalable.",
      );
    }

    const [location] = await tx
      .select({ id: stockLocations.id, code: stockLocations.code })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.tenantId, input.tenantId),
          eq(stockLocations.id, input.locationId),
          eq(stockLocations.type, "internal"),
          eq(stockLocations.active, true),
        ),
      )
      .limit(1);
    if (!location) {
      throw new SalesError("Emplacement de livraison introuvable ou inactif.");
    }

    const orderLineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(
        and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.orderId, order.id)),
      )
      .orderBy(salesOrderLines.lineNumber)
      .for("update");
    const orderLinesById = new Map(orderLineRows.map((line) => [line.id, line]));
    const types = await articleTypes(
      tx,
      input.tenantId,
      orderLineRows.map((line) => line.articleId),
    );

    const requested = input.lines.filter((line) => {
      const raw = line.qty;
      return raw !== null && raw !== undefined && String(raw).trim() !== "";
    });
    if (requested.length === 0) {
      throw new SalesError("Livraison : au moins une quantité positive est obligatoire.");
    }

    interface DeliveryStep {
      readonly line: (typeof orderLineRows)[number];
      readonly qty: string;
      readonly nextDelivered: string;
      readonly nextState: DeliveryState;
    }

    const steps: DeliveryStep[] = [];
    const seen = new Set<string>();

    for (const item of requested) {
      if (seen.has(item.orderLineId)) {
        throw new SalesError("Une même ligne de commande apparaît deux fois dans la livraison.");
      }
      seen.add(item.orderLineId);

      const line = orderLinesById.get(item.orderLineId);
      if (!line) {
        throw new SalesError("Une ligne de livraison n'appartient pas à cette commande.");
      }
      if (types.get(line.articleId) !== "product") {
        throw new SalesError(
          `Ligne ${line.lineNumber} : un service ne fait l'objet d'aucune livraison de stock.`,
        );
      }
      if (line.deliveryState === "delivered") {
        throw new SalesError(`Ligne ${line.lineNumber} : la ligne est déjà intégralement livrée.`);
      }

      const parsed = parseQuantity(item.qty, `Ligne ${line.lineNumber} · quantité`);
      if (!parsed.value) {
        throw new SalesError(parsed.errors.join("\n"));
      }

      const remaining = subtractQuantity(line.qty, line.deliveredQty);
      if (compareQuantity(parsed.value, remaining) > 0) {
        throw new SalesError(
          `Ligne ${line.lineNumber} : quantité livrée supérieure au reliquat de ${formatQuantity(remaining)}.`,
        );
      }

      const nextDelivered = addQuantity(line.deliveredQty, parsed.value);
      steps.push({
        line,
        qty: parsed.value,
        nextDelivered,
        nextState: computeLineDeliveryState(line.qty, nextDelivered),
      });
    }

    const defaults = await ensureDefaultLocations(tx, input.tenantId);
    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "delivery",
      date: date.value,
    });

    const [delivery] = await tx
      .insert(deliveries)
      .values({
        tenantId: input.tenantId,
        number,
        orderId: order.id,
        locationId: location.id,
        status: "validated",
        deliveredDate: date.value,
        notes,
        createdBy: input.actorUserId,
      })
      .returning({ id: deliveries.id });

    if (!delivery) {
      throw new SalesError("Le bon de livraison n'a pas pu être écrit.");
    }

    await tx.insert(deliveryLines).values(
      steps.map((step, index) => ({
        tenantId: input.tenantId,
        deliveryId: delivery.id,
        lineNumber: index + 1,
        orderLineId: step.line.id,
        articleId: step.line.articleId,
        qty: step.qty,
      })),
    );

    const move = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: "outgoing",
      fromLocationId: location.id,
      toLocationId: defaults.customerId,
      partnerId: order.customerId,
      salesOrderId: order.id,
      deliveryId: delivery.id,
      realDate: date.value,
      notes: `Livraison ${number}`,
      lines: steps.map((step) => ({
        articleId: step.line.articleId,
        salesOrderLineId: step.line.id,
        qty: step.qty,
        unitPriceXof: step.line.unitPriceXof,
      })),
    });

    for (const step of steps) {
      await tx
        .update(salesOrderLines)
        .set({ deliveredQty: step.nextDelivered, deliveryState: step.nextState })
        .where(
          and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.id, step.line.id)),
        );
    }

    const stateByLine = new Map(steps.map((step) => [step.line.id, step.nextState]));
    const orderDeliveryState = computeOrderDeliveryState(
      orderLineRows.map((line) => ({
        type: types.get(line.articleId) ?? "service",
        deliveryState: stateByLine.get(line.id) ?? line.deliveryState,
      })),
    );
    await tx
      .update(salesOrders)
      .set({ deliveryState: orderDeliveryState, updatedAt: new Date() })
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, order.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.delivery.create",
      entityType: "delivery",
      entityId: delivery.id,
      details: {
        number,
        orderNumber: order.number,
        moveNumber: move.number,
        locationCode: location.code,
        lineCount: steps.length,
      },
    });

    return { deliveryId: delivery.id, number, moveNumber: move.number };
  });
}

export async function cancelDelivery(
  db: Database,
  input: CancelDeliveryInput,
): Promise<CancelDeliveryResult> {
  return db.transaction(async (tx) => {
    const notes = parseNotes(input.notes ?? null);

    const [delivery] = await tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, input.tenantId), eq(deliveries.id, input.deliveryId)))
      .limit(1)
      .for("update");

    if (!delivery) {
      throw new SalesError("Livraison introuvable dans cet espace de travail.");
    }
    if (delivery.status !== "validated") {
      throw new SalesError("Cette livraison est déjà annulée.");
    }

    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, delivery.orderId)))
      .limit(1)
      .for("update");
    if (!order) {
      throw new SalesError("La commande de cette livraison est introuvable.");
    }

    const [original] = await tx
      .select()
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.tenantId, input.tenantId),
          eq(stockMoves.deliveryId, delivery.id),
          eq(stockMoves.type, "outgoing"),
        ),
      )
      .limit(1);
    if (!original) {
      throw new SalesError("Le mouvement de sortie de cette livraison est introuvable.");
    }

    const originalLines = await tx
      .select({
        articleId: stockMoveLines.articleId,
        salesOrderLineId: stockMoveLines.salesOrderLineId,
        qty: stockMoveLines.qty,
        unitPriceXof: stockMoveLines.unitPriceXof,
      })
      .from(stockMoveLines)
      .where(
        and(eq(stockMoveLines.tenantId, input.tenantId), eq(stockMoveLines.moveId, original.id)),
      )
      .orderBy(stockMoveLines.lineNumber)
      .for("update");

    if (originalLines.length === 0) {
      throw new SalesError("Le mouvement de sortie de cette livraison est vide.");
    }

    const orderLineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(
        and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.orderId, order.id)),
      )
      .orderBy(salesOrderLines.lineNumber)
      .for("update");
    const orderLinesById = new Map(orderLineRows.map((line) => [line.id, line]));
    const types = await articleTypes(
      tx,
      input.tenantId,
      orderLineRows.map((line) => line.articleId),
    );

    const stateByLine = new Map<string, DeliveryState>();
    const nextDeliveredByLine = new Map<string, string>();

    for (const moveLine of originalLines) {
      if (!moveLine.salesOrderLineId) {
        continue;
      }
      const line = orderLinesById.get(moveLine.salesOrderLineId);
      if (!line) {
        continue;
      }
      const candidate = subtractQuantity(line.deliveredQty, moveLine.qty);
      const nextDelivered = compareQuantity(candidate, "0") < 0 ? "0" : candidate;
      if (compareQuantity(line.invoicedQty, nextDelivered) > 0) {
        throw new SalesError(
          `Ligne ${line.lineNumber} : annulation refusée, ${formatQuantity(
            line.invoicedQty,
          )} déjà facturé(s) pour ${formatQuantity(nextDelivered)} livré(s) après annulation.`,
        );
      }
      nextDeliveredByLine.set(line.id, nextDelivered);
      stateByLine.set(line.id, computeLineDeliveryState(line.qty, nextDelivered));
    }

    const reversal = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: "incoming",
      fromLocationId: original.toLocationId,
      toLocationId: original.fromLocationId,
      partnerId: original.partnerId,
      salesOrderId: original.salesOrderId,
      deliveryId: delivery.id,
      cancelsMoveId: original.id,
      realDate: todayIsoDate(),
      notes: notes ? `Annulation ${delivery.number} — ${notes}` : `Annulation ${delivery.number}`,
      lines: originalLines.map((line) => ({
        articleId: line.articleId,
        salesOrderLineId: line.salesOrderLineId,
        qty: line.qty,
        unitPriceXof: line.unitPriceXof,
      })),
    });

    for (const [lineId, nextDelivered] of nextDeliveredByLine) {
      await tx
        .update(salesOrderLines)
        .set({ deliveredQty: nextDelivered, deliveryState: stateByLine.get(lineId) })
        .where(and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.id, lineId)));
    }

    const orderDeliveryState = computeOrderDeliveryState(
      orderLineRows.map((line) => ({
        type: types.get(line.articleId) ?? "service",
        deliveryState: stateByLine.get(line.id) ?? line.deliveryState,
      })),
    );
    await tx
      .update(salesOrders)
      .set({ deliveryState: orderDeliveryState, updatedAt: new Date() })
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, order.id)));

    await tx
      .update(deliveries)
      .set({
        status: "cancelled",
        cancelledBy: input.actorUserId,
        cancelledAt: new Date(),
      })
      .where(and(eq(deliveries.tenantId, input.tenantId), eq(deliveries.id, delivery.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.delivery.cancel",
      entityType: "delivery",
      entityId: delivery.id,
      details: {
        number: delivery.number,
        orderNumber: order.number,
        reversalMoveNumber: reversal.number,
        originalMoveNumber: original.number,
        lineCount: originalLines.length,
        notes,
      },
    });

    return { number: delivery.number, moveNumber: reversal.number };
  });
}
