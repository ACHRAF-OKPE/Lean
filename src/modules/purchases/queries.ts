import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  partners,
  purchaseOrderLines,
  purchaseOrderSignatures,
  purchaseOrders,
  purchaseSettings,
  receptions,
  stockLocations,
  stockMoves,
  tasks,
  type ArticleType,
  type PurchaseOrderMatchingStatus,
  type PurchaseOrderStatus,
  type ReceiptState,
  type ReceptionStatus,
  users,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { recordDocumentEvent } from "@/modules/discussion/queries";
import type { DocumentEventType } from "@/modules/discussion/events";
import {
  computeThreeWayMatching,
  type InvoicedLineInput,
  type LineMatchingResult,
  type OrderLineForMatching,
  type ThreeWayMatchingResult,
} from "./matching";
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
import { createTaskForPurchaseOrder } from "@/modules/tasks/queries";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { normalizeQuantity, remainingQuantity } from "@/modules/stock/quantities";
import { loadSupplierPaymentSnapshot } from "./supplier-payment-snapshot";
import type { SupplierBankSnapshot } from "./supplier-payment-snapshot";
import { initializePurchaseSignatureChain } from "./signatures";

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
  readonly matchingStatus?: PurchaseOrderMatchingStatus;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly exTaxTotal: number;
  readonly signatureWorkflowRequired: boolean;
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
    readonly supplierPaymentTermDays: number | null;
    readonly externalReference: string | null;
    readonly notes: string | null;
    readonly legalClauses: string | null;
    readonly supplierInvoiceNumber: string | null;
    readonly supplierInvoiceDate: string | null;
    readonly supplierInvoiceAmountXof: number | null;
    readonly matchingStatus: PurchaseOrderMatchingStatus;
    readonly matchingLines: readonly LineMatchingResult[] | null;
    readonly matchedAt: Date | null;
    readonly matchedByName: string | null;
    readonly disputeNotes: string | null;
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

export interface PurchaseOrderPaymentDetails {
  readonly paymentTermDays: number | null;
  readonly bankDetails: SupplierBankSnapshot | null;
}

/** PUR-008 — ne lit que l'instantané du PO, et l'appelant doit avoir la garde finance. */
export async function getPurchaseOrderPaymentDetails(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<PurchaseOrderPaymentDetails | null> {
  const [row] = await db
    .select({
      paymentTermDays: purchaseOrders.supplierPaymentTermDays,
      bankDetails: purchaseOrders.supplierBankDetails,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
    .limit(1);
  return row ?? null;
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
      matchingStatus: purchaseOrders.matchingStatus,
      orderDate: purchaseOrders.orderDate,
      expectedReceiptDate: purchaseOrders.expectedReceiptDate,
      supplierCode: partners.code,
      supplierName: partners.name,
      exTaxTotal: purchaseOrders.exTaxTotal,
      signatureWorkflowRequired: purchaseOrders.signatureWorkflowRequired,
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
      supplierPaymentTermDays: purchaseOrders.supplierPaymentTermDays,
      supplierCode: partners.code,
      supplierName: partners.name,
      externalReference: purchaseOrders.externalReference,
      notes: purchaseOrders.notes,
      legalClauses: purchaseOrders.legalClauses,
      supplierInvoiceNumber: purchaseOrders.supplierInvoiceNumber,
      supplierInvoiceDate: purchaseOrders.supplierInvoiceDate,
      supplierInvoiceAmountXof: purchaseOrders.supplierInvoiceAmountXof,
      matchingStatus: purchaseOrders.matchingStatus,
      matchingLines: purchaseOrders.matchingLines,
      matchedAt: purchaseOrders.matchedAt,
      matchedByName: users.name,
      disputeNotes: purchaseOrders.disputeNotes,
      exTaxTotal: purchaseOrders.exTaxTotal,
      signatureWorkflowRequired: purchaseOrders.signatureWorkflowRequired,
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
    .leftJoin(users, eq(users.id, purchaseOrders.matchedBy))
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

export interface CreatePurchaseOrderInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly data: DraftOrderInput;
  readonly legalClauses?: unknown;
}

export interface CreatePurchaseOrderResult {
  readonly id: string;
  readonly warnings: readonly string[];
}

export async function createPurchaseOrder(
  db: Database,
  input: CreatePurchaseOrderInput,
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

  const legalClauses =
    input.legalClauses === null || input.legalClauses === undefined
      ? null
      : String(input.legalClauses).trim() || null;
  if (legalClauses !== null && legalClauses.length > 5000) {
    throw new PurchaseError("Clauses légales : 5000 caractères maximum.");
  }

  return db.transaction(async (tx) => {
    const snapshot = await loadSupplierPaymentSnapshot(tx, {
      tenantId: input.tenantId,
      supplierId: order.supplier.id,
    });

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
        supplierPaymentTermDays: snapshot?.paymentTermDays ?? null,
        supplierBankDetails: snapshot?.bankDetails ?? null,
        legalClauses,
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
        hasBankDetails: snapshot?.bankDetails !== null,
        hasLegalClauses: legalClauses !== null,
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
  readonly signatureWorkflowStarted: boolean;
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
    if (!canApplyAction(order.status, input.action, order.receiptState)) {
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

    // PUR-014 — confirmer une commande réservée à l'assignee de la tâche de validation en cours.
    // Si aucun validateur n'est paramétré, tout gestionnaire peut confirmer (comportement historique).
    if (input.action === "confirm") {
      const [settings] = await tx
        .select({ validatorUserId: purchaseSettings.validatorUserId })
        .from(purchaseSettings)
        .where(eq(purchaseSettings.tenantId, input.tenantId))
        .limit(1);
      if (settings?.validatorUserId) {
        const [validationTask] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.tenantId, input.tenantId),
              eq(tasks.relatedEntityType, "purchase_order"),
              eq(tasks.relatedEntityId, order.id),
              eq(tasks.status, "open"),
              eq(tasks.assigneeUserId, input.actorUserId),
            ),
          )
          .limit(1);
        if (!validationTask) {
          throw new PurchaseError(
            "Seul le validateur assigné à la tâche de validation peut confirmer cette commande.",
          );
        }
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

    // Créer une tâche pour le validateur lors de la demande
    if (input.action === "request") {
      const [settings] = await tx
        .select({ validatorUserId: purchaseSettings.validatorUserId })
        .from(purchaseSettings)
        .where(eq(purchaseSettings.tenantId, input.tenantId))
        .limit(1);
      if (settings?.validatorUserId) {
        await createTaskForPurchaseOrder(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          assigneeUserId: settings.validatorUserId,
          title: `Valider la commande fournisseur`,
          description: `Commande brouillon à valider : ${order.id}`,
          orderId: order.id,
          priority: "high",
        });
      }
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

    const signatureWorkflowStarted =
      input.action === "confirm"
        ? await initializePurchaseSignatureChain(tx, {
            tenantId: input.tenantId,
            orderId: order.id,
          })
        : false;
    if (input.action === "confirm" && signatureWorkflowStarted) {
      await tx
        .update(purchaseOrders)
        .set({ signatureWorkflowRequired: true })
        .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, order.id)));

      // PUR-012 — une tâche est créée pour le premier signataire du circuit
      const [firstStep] = await tx
        .select({ signerUserId: purchaseOrderSignatures.signerUserId })
        .from(purchaseOrderSignatures)
        .innerJoin(users, eq(users.id, purchaseOrderSignatures.signerUserId))
        .where(
          and(
            eq(purchaseOrderSignatures.tenantId, input.tenantId),
            eq(purchaseOrderSignatures.orderId, order.id),
          ),
        )
        .orderBy(asc(purchaseOrderSignatures.sequence))
        .limit(1);
      if (firstStep) {
        await createTaskForPurchaseOrder(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          assigneeUserId: firstStep.signerUserId,
          title: `Signer le bon de commande ${number}`,
          description:
            "Circuit de signature, étape 1 : déposez le PDF signé puis confirmez le dépôt pour le transmettre au signataire suivant.",
          orderId: order.id,
          priority: "high",
        });
      }
    }

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

    return { id: order.id, number, status: nextStatus, signatureWorkflowStarted };
  });
}

export function canReceive(status: PurchaseOrderStatus): boolean {
  return status === "confirmed";
}

export function canCancelOrder(status: PurchaseOrderStatus): boolean {
  return canApplyAction(status, "cancel");
}

/** PUR-014 — vérifier si un utilisateur peut confirmer une commande. */
export async function canConfirmPurchaseOrder(
  db: Database,
  input: { tenantId: string; userId: string; orderId: string },
): Promise<boolean> {
  const [order] = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
    .limit(1);
  if (!order || !canApplyAction(order.status, "confirm")) {
    return false;
  }

  const [settings] = await db
    .select({ validatorUserId: purchaseSettings.validatorUserId })
    .from(purchaseSettings)
    .where(eq(purchaseSettings.tenantId, input.tenantId))
    .limit(1);
  if (!settings?.validatorUserId) {
    return true;
  }

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, input.tenantId),
        eq(tasks.relatedEntityType, "purchase_order"),
        eq(tasks.relatedEntityId, input.orderId),
        eq(tasks.status, "open"),
        eq(tasks.assigneeUserId, input.userId),
      ),
    )
    .limit(1);
  return Boolean(task);
}

export interface RecordInvoiceAndMatchInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly actorUserId: string;
  readonly supplierInvoiceNumber: string;
  readonly supplierInvoiceDate: string;
  readonly supplierInvoiceAmountXof?: number | null;
  readonly lines: readonly InvoicedLineInput[];
  readonly disputeNotes?: string | null;
}

/**
 * PUR-016 — Enregistre la facture fournisseur, calcule le 3-Way Match et délivre le Bon à Payer
 */
export async function recordSupplierInvoiceAndMatch(
  db: Database,
  input: RecordInvoiceAndMatchInput,
): Promise<ThreeWayMatchingResult> {
  const invoiceNumber = input.supplierInvoiceNumber.trim();
  if (!invoiceNumber || invoiceNumber.length > 80) {
    throw new PurchaseError("Numéro de facture fournisseur requis (80 caractères maximum).");
  }
  if (!input.supplierInvoiceDate) {
    throw new PurchaseError("Date de facture requise.");
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .for("update")
      .limit(1);

    if (!order) {
      throw new PurchaseError("Commande fournisseur introuvable.");
    }
    if (order.status !== "confirmed" && order.status !== "closed") {
      throw new PurchaseError("Le rapprochement exige une commande confirmée ou clôturée.");
    }

    const lineRows = await tx
      .select({
        id: purchaseOrderLines.id,
        name: purchaseOrderLines.name,
        unitCode: purchaseOrderLines.unitCode,
        qty: purchaseOrderLines.qty,
        unitPriceXof: purchaseOrderLines.unitPriceXof,
        receivedQty: purchaseOrderLines.receivedQty,
        articleType: articles.type,
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
      );

    if (lineRows.length === 0) {
      throw new PurchaseError("La commande ne comporte aucune ligne à rapprocher.");
    }

    const orderLinesForMatching: OrderLineForMatching[] = lineRows.map((line) => ({
      orderLineId: line.id,
      name: line.name,
      unitCode: line.unitCode,
      type: line.articleType,
      orderedQty: line.qty,
      orderedUnitPriceXof: line.unitPriceXof,
      receivedQty: line.receivedQty,
    }));

    const result = computeThreeWayMatching(orderLinesForMatching, {
      supplierInvoiceNumber: invoiceNumber,
      supplierInvoiceDate: input.supplierInvoiceDate,
      supplierInvoiceAmountXof: input.supplierInvoiceAmountXof,
      lines: input.lines,
    });

    await tx
      .update(purchaseOrders)
      .set({
        supplierInvoiceNumber: result.supplierInvoiceNumber,
        supplierInvoiceDate: result.supplierInvoiceDate,
        supplierInvoiceAmountXof: result.totalInvoicedXof,
        matchingStatus: result.status,
        matchingLines: result.lines,
        matchedAt: new Date(),
        matchedBy: input.actorUserId,
        disputeNotes: input.disputeNotes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase_order.matched",
      entityType: "purchase_order",
      entityId: input.orderId,
      details: {
        supplierInvoiceNumber: result.supplierInvoiceNumber,
        status: result.status,
        isApprovedForPayment: result.isApprovedForPayment,
        totalInvoicedXof: result.totalInvoicedXof,
        netDiscrepancyXof: result.netDiscrepancyXof,
      },
    });

    if (result.isApprovedForPayment) {
      await recordDocumentEvent(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        entityType: "purchase_order",
        entityId: input.orderId,
        event: {
          type: "purchase_order.matched",
          key: `purchase_order_matched_${input.orderId}_${result.supplierInvoiceNumber}_${Date.now()}`,
          number: result.supplierInvoiceNumber,
          amountXof: result.totalInvoicedXof,
        },
      });
    } else {
      await recordDocumentEvent(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        entityType: "purchase_order",
        entityId: input.orderId,
        event: {
          type: "purchase_order.dispute",
          key: `purchase_order_dispute_${input.orderId}_${result.supplierInvoiceNumber}_${Date.now()}`,
          number: result.supplierInvoiceNumber,
          amountXof: result.totalInvoicedXof,
        },
      });
    }

    return result;
  });
}

/**
 * PUR-016 — Résolution manuelle ou accord d'une dérogation sur litige
 */
export async function resolveMatchingDispute(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly orderId: string;
    readonly actorUserId: string;
    readonly resolutionNotes: string;
  },
): Promise<void> {
  const notes = input.resolutionNotes.trim();
  if (!notes) {
    throw new PurchaseError("Motif de résolution requis.");
  }

  await db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        supplierInvoiceNumber: purchaseOrders.supplierInvoiceNumber,
        supplierInvoiceAmountXof: purchaseOrders.supplierInvoiceAmountXof,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .for("update")
      .limit(1);

    if (!order) {
      throw new PurchaseError("Commande fournisseur introuvable.");
    }

    await tx
      .update(purchaseOrders)
      .set({
        matchingStatus: "matched",
        disputeNotes: notes,
        matchedAt: new Date(),
        matchedBy: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase_order.dispute_resolved",
      entityType: "purchase_order",
      entityId: input.orderId,
      details: {
        supplierInvoiceNumber: order.supplierInvoiceNumber,
        notes,
      },
    });

    await recordDocumentEvent(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      entityType: "purchase_order",
      entityId: input.orderId,
      event: {
        type: "purchase_order.matched",
        key: `purchase_order_resolved_${input.orderId}_${Date.now()}`,
        number: order.supplierInvoiceNumber,
        amountXof: order.supplierInvoiceAmountXof,
      },
    });
  });
}
