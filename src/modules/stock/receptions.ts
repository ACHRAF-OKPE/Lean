import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  purchaseOrderLines,
  purchaseOrders,
  receptions,
  stockLocations,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import type { ReceiptState } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { computeLineReceiptState, computeOrderReceiptState } from "@/modules/purchases/lifecycle";
import { parseIsoDate } from "@/modules/shared/validation";
import { PurchaseError } from "@/modules/purchases/errors";
import {
  addQuantity,
  compareQuantity,
  formatQuantity,
  parseQuantity,
  subtractQuantity,
} from "./quantities";
import { ensureDefaultLocations } from "./locations";
import { insertStockMove } from "./moves";
import { nextDocumentNumber } from "./sequences";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ReceptionLineInput {
  readonly orderLineId: string;
  readonly qty: unknown;
}

export interface CreateReceptionInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly orderId: string;
  readonly locationId: string;
  readonly receivedDate: unknown;
  readonly notes: unknown;
  readonly lines: readonly ReceptionLineInput[];
}

export interface CreateReceptionResult {
  readonly receptionId: string;
  readonly number: string;
  readonly moveNumber: string;
  readonly warnings: readonly string[];
}

export interface CancelReceptionInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly receptionId: string;
  readonly notes?: unknown;
}

export interface CancelReceptionResult {
  readonly number: string;
  readonly moveNumber: string;
}

function parseNotes(raw: unknown): string | null {
  const notes = raw === null || raw === undefined ? "" : String(raw).trim();
  if (notes.length > 1000) {
    throw new PurchaseError("Notes : 1000 caractères maximum.");
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

export async function createReception(
  db: Database,
  input: CreateReceptionInput,
): Promise<CreateReceptionResult> {
  return db.transaction(async (tx) => {
    const date = parseIsoDate(input.receivedDate, "Date de réception", true);
    if (!date.value) {
      throw new PurchaseError(date.errors.join("\n"));
    }
    if (date.value > todayIsoDate()) {
      throw new PurchaseError("La date de réception ne peut pas être dans le futur.");
    }
    const notes = parseNotes(input.notes);

    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .limit(1)
      .for("update");

    if (!order) {
      throw new PurchaseError("Commande introuvable dans cet espace de travail.");
    }
    if (order.status !== "confirmed") {
      throw new PurchaseError(
        "Une réception exige une commande confirmée. Demandez puis confirmez la commande.",
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
      throw new PurchaseError("Emplacement de réception introuvable ou inactif.");
    }

    const orderLineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.tenantId, input.tenantId),
          eq(purchaseOrderLines.orderId, order.id),
        ),
      )
      .orderBy(purchaseOrderLines.lineNumber)
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
      throw new PurchaseError("Réception : au moins une quantité positive est obligatoire.");
    }

    interface ReceiptStep {
      readonly line: (typeof orderLineRows)[number];
      readonly qty: string;
      readonly nextReceived: string;
      readonly nextState: ReceiptState;
    }

    const steps: ReceiptStep[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();

    for (const item of requested) {
      if (seen.has(item.orderLineId)) {
        throw new PurchaseError("Une même ligne de commande apparaît deux fois dans la réception.");
      }
      seen.add(item.orderLineId);

      const line = orderLinesById.get(item.orderLineId);
      if (!line) {
        throw new PurchaseError("Une ligne de réception n'appartient pas à cette commande.");
      }
      if (types.get(line.articleId) !== "product") {
        throw new PurchaseError(
          `Ligne ${line.lineNumber} : un service ne génère pas de mouvement de stock.`,
        );
      }
      if (line.receiptState === "received") {
        throw new PurchaseError(
          `Ligne ${line.lineNumber} : la ligne est déjà intégralement reçue, aucune réception supplémentaire n'est acceptée.`,
        );
      }

      const parsed = parseQuantity(item.qty, `Ligne ${line.lineNumber} · quantité`);
      if (!parsed.value) {
        throw new PurchaseError(parsed.errors.join("\n"));
      }

      const nextReceived = addQuantity(line.receivedQty, parsed.value);
      if (compareQuantity(nextReceived, line.qty) > 0) {
        warnings.push(
          `Ligne ${line.lineNumber} : sur-réception de ${formatQuantity(
            subtractQuantity(nextReceived, line.qty),
          )} (commandé ${formatQuantity(line.qty)}, reçu ${formatQuantity(nextReceived)}).`,
        );
      }

      steps.push({
        line,
        qty: parsed.value,
        nextReceived,
        nextState: computeLineReceiptState(line.qty, nextReceived),
      });
    }

    const defaults = await ensureDefaultLocations(tx, input.tenantId);
    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "reception",
      date: date.value,
    });

    const [reception] = await tx
      .insert(receptions)
      .values({
        tenantId: input.tenantId,
        number,
        orderId: order.id,
        locationId: location.id,
        status: "validated",
        receivedDate: date.value,
        notes,
        createdBy: input.actorUserId,
      })
      .returning({ id: receptions.id });

    if (!reception) {
      throw new PurchaseError("Le bon de réception n'a pas pu être écrit.");
    }

    const move = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: "incoming",
      fromLocationId: defaults.supplierId,
      toLocationId: location.id,
      partnerId: order.supplierId,
      purchaseOrderId: order.id,
      receptionId: reception.id,
      realDate: date.value,
      notes: `Réception ${number}`,
      lines: steps.map((step) => ({
        articleId: step.line.articleId,
        purchaseOrderLineId: step.line.id,
        qty: step.qty,
        unitPriceXof: step.line.unitPriceXof,
      })),
    });

    for (const step of steps) {
      await tx
        .update(purchaseOrderLines)
        .set({ receivedQty: step.nextReceived, receiptState: step.nextState })
        .where(
          and(
            eq(purchaseOrderLines.tenantId, input.tenantId),
            eq(purchaseOrderLines.id, step.line.id),
          ),
        );
    }

    const stateByLine = new Map(steps.map((step) => [step.line.id, step.nextState]));
    const orderReceiptState = computeOrderReceiptState(
      orderLineRows.map((line) => ({
        type: types.get(line.articleId) ?? "service",
        receiptState: stateByLine.get(line.id) ?? line.receiptState,
      })),
    );
    await tx
      .update(purchaseOrders)
      .set({ receiptState: orderReceiptState, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, order.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.reception.create",
      entityType: "reception",
      entityId: reception.id,
      details: {
        number,
        orderNumber: order.number,
        moveNumber: move.number,
        locationCode: location.code,
        lineCount: steps.length,
        warnings,
      },
    });

    return { receptionId: reception.id, number, moveNumber: move.number, warnings };
  });
}

export async function cancelReception(
  db: Database,
  input: CancelReceptionInput,
): Promise<CancelReceptionResult> {
  return db.transaction(async (tx) => {
    const notes = parseNotes(input.notes ?? null);

    const [reception] = await tx
      .select()
      .from(receptions)
      .where(and(eq(receptions.tenantId, input.tenantId), eq(receptions.id, input.receptionId)))
      .limit(1)
      .for("update");

    if (!reception) {
      throw new PurchaseError("Réception introuvable dans cet espace de travail.");
    }
    if (reception.status !== "validated") {
      throw new PurchaseError("Cette réception est déjà annulée.");
    }

    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, reception.orderId)),
      )
      .limit(1)
      .for("update");
    if (!order) {
      throw new PurchaseError("La commande de cette réception est introuvable.");
    }

    const [original] = await tx
      .select()
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.tenantId, input.tenantId),
          eq(stockMoves.receptionId, reception.id),
          eq(stockMoves.type, "incoming"),
        ),
      )
      .limit(1);
    if (!original) {
      throw new PurchaseError("Le mouvement d'entrée de cette réception est introuvable.");
    }

    const originalLines = await tx
      .select({
        articleId: stockMoveLines.articleId,
        purchaseOrderLineId: stockMoveLines.purchaseOrderLineId,
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
      throw new PurchaseError("Le mouvement d'entrée de cette réception est vide.");
    }

    const reversal = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: "outgoing",
      fromLocationId: original.toLocationId,
      toLocationId: original.fromLocationId,
      partnerId: original.partnerId,
      purchaseOrderId: original.purchaseOrderId,
      receptionId: reception.id,
      cancelsMoveId: original.id,
      realDate: todayIsoDate(),
      notes: notes ? `Annulation ${reception.number} — ${notes}` : `Annulation ${reception.number}`,
      lines: originalLines.map((line) => ({
        articleId: line.articleId,
        purchaseOrderLineId: line.purchaseOrderLineId,
        qty: line.qty,
        unitPriceXof: line.unitPriceXof,
      })),
    });

    const orderLineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.tenantId, input.tenantId),
          eq(purchaseOrderLines.orderId, order.id),
        ),
      )
      .orderBy(purchaseOrderLines.lineNumber)
      .for("update");
    const orderLinesById = new Map(orderLineRows.map((line) => [line.id, line]));
    const types = await articleTypes(
      tx,
      input.tenantId,
      orderLineRows.map((line) => line.articleId),
    );

    const stateByLine = new Map<string, ReceiptState>();
    for (const moveLine of originalLines) {
      if (!moveLine.purchaseOrderLineId) {
        continue;
      }
      const line = orderLinesById.get(moveLine.purchaseOrderLineId);
      if (!line) {
        continue;
      }
      const candidate = subtractQuantity(line.receivedQty, moveLine.qty);
      const nextReceived = compareQuantity(candidate, "0") < 0 ? "0" : candidate;
      const nextState = computeLineReceiptState(line.qty, nextReceived);
      await tx
        .update(purchaseOrderLines)
        .set({ receivedQty: nextReceived, receiptState: nextState })
        .where(
          and(eq(purchaseOrderLines.tenantId, input.tenantId), eq(purchaseOrderLines.id, line.id)),
        );
      stateByLine.set(line.id, nextState);
    }

    const orderReceiptState = computeOrderReceiptState(
      orderLineRows.map((line) => ({
        type: types.get(line.articleId) ?? "service",
        receiptState: stateByLine.get(line.id) ?? line.receiptState,
      })),
    );
    await tx
      .update(purchaseOrders)
      .set({ receiptState: orderReceiptState, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, order.id)));

    await tx
      .update(receptions)
      .set({
        status: "cancelled",
        cancelledBy: input.actorUserId,
        cancelledAt: new Date(),
      })
      .where(and(eq(receptions.tenantId, input.tenantId), eq(receptions.id, reception.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.reception.cancel",
      entityType: "reception",
      entityId: reception.id,
      details: {
        number: reception.number,
        orderNumber: order.number,
        reversalMoveNumber: reversal.number,
        originalMoveNumber: original.number,
        lineCount: originalLines.length,
        notes,
      },
    });

    return { number: reception.number, moveNumber: reversal.number };
  });
}
