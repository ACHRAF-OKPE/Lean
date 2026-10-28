import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  companySettings,
  exchangeMessages,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  supplierReplies,
  type SupplierReplyAvailability,
} from "@/db/schema";
import { recordDocumentEvent } from "@/modules/discussion/queries";
import { ExchangeError } from "./errors";
import {
  MAX_REPLIES_PER_LINK,
  hashReplyToken,
  isReplyTokenShape,
  type SupplierAttachment,
  type SupplierReplyData,
} from "./replies";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface SupplierReplyLine {
  readonly lineNumber: number;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface SupplierReplyContext {
  readonly tenantId: string;
  readonly messageId: string;
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly externalReference: string | null;
  readonly notes: string | null;
  readonly totalXof: number;
  readonly companyName: string;
  readonly supplierName: string;
  readonly recipient: string;
  readonly recipientName: string | null;
  readonly expiresAt: Date;
  readonly replyCount: number;
  readonly lines: readonly SupplierReplyLine[];
}

export interface SupplierReplySummary {
  readonly id: string;
  readonly exchangeMessageId: string;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly availability: SupplierReplyAvailability;
  readonly comment: string | null;
  readonly leadTimeDays: number | null;
  readonly proposedTotalXof: number | null;
  readonly attachmentName: string | null;
  readonly attachmentSize: number | null;
  readonly createdAt: Date;
}

interface ContextRow {
  readonly tenantId: string;
  readonly messageId: string;
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly externalReference: string | null;
  readonly notes: string | null;
  readonly totalXof: number;
  readonly companyName: string;
  readonly supplierName: string;
  readonly recipient: string;
  readonly recipientName: string | null;
  readonly expiresAt: Date;
}

async function loadContextRow(
  executor: Executor,
  token: string,
  forUpdate: boolean,
): Promise<ContextRow | null> {
  if (!isReplyTokenShape(token)) {
    return null;
  }

  const query = executor
    .select({
      tenantId: exchangeMessages.tenantId,
      messageId: exchangeMessages.id,
      orderId: exchangeMessages.orderId,
      orderNumber: purchaseOrders.number,
      orderDate: purchaseOrders.orderDate,
      expectedReceiptDate: purchaseOrders.expectedReceiptDate,
      externalReference: purchaseOrders.externalReference,
      notes: purchaseOrders.notes,
      totalXof: purchaseOrders.exTaxTotal,
      companyName: companySettings.legalName,
      supplierName: partners.name,
      recipient: exchangeMessages.recipient,
      recipientName: exchangeMessages.recipientName,
      expiresAt: exchangeMessages.replyTokenExpiresAt,
    })
    .from(exchangeMessages)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.tenantId, exchangeMessages.tenantId),
        eq(purchaseOrders.id, exchangeMessages.orderId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .innerJoin(companySettings, eq(companySettings.tenantId, exchangeMessages.tenantId))
    .where(
      and(
        eq(exchangeMessages.replyTokenHash, hashReplyToken(token)),
        eq(exchangeMessages.status, "sent"),
      ),
    )
    .limit(1);

  const rows = forUpdate ? await query.for("update") : await query;
  const [row] = rows;
  if (!row || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    ...row,
    expiresAt: row.expiresAt,
  };
}

async function countReplies(
  executor: Executor,
  tenantId: string,
  exchangeMessageId: string,
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(supplierReplies)
    .where(
      and(
        eq(supplierReplies.tenantId, tenantId),
        eq(supplierReplies.exchangeMessageId, exchangeMessageId),
      ),
    );
  return row?.total ?? 0;
}

async function loadLines(
  executor: Executor,
  tenantId: string,
  orderId: string,
): Promise<readonly SupplierReplyLine[]> {
  return executor
    .select({
      lineNumber: purchaseOrderLines.lineNumber,
      name: purchaseOrderLines.name,
      unitCode: purchaseOrderLines.unitCode,
      qty: purchaseOrderLines.qty,
      unitPriceXof: purchaseOrderLines.unitPriceXof,
      lineTotalXof: purchaseOrderLines.lineTotalXof,
    })
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.orderId, orderId)))
    .orderBy(asc(purchaseOrderLines.lineNumber));
}

export async function getSupplierReplyContext(
  db: Database,
  token: string,
): Promise<SupplierReplyContext | null> {
  const row = await loadContextRow(db, token, false);
  if (!row) {
    return null;
  }
  const [replyCount, lines] = await Promise.all([
    countReplies(db, row.tenantId, row.messageId),
    loadLines(db, row.tenantId, row.orderId),
  ]);
  return { ...row, replyCount, lines };
}

export async function createSupplierReply(
  db: Database,
  input: { readonly token: string; readonly data: SupplierReplyData },
): Promise<{ readonly replyId: string; readonly orderId: string }> {
  return db.transaction(async (tx) => {
    const context = await loadContextRow(tx, input.token, true);
    if (!context) {
      throw new ExchangeError("Ce lien de réponse n'est plus actif.");
    }

    const replyCount = await countReplies(tx, context.tenantId, context.messageId);
    if (replyCount >= MAX_REPLIES_PER_LINK) {
      throw new ExchangeError(
        "Ce lien a reçu le nombre maximal de réponses. Contactez votre interlocuteur.",
      );
    }

    const { data } = input;
    const attachment: SupplierAttachment | null = data.attachment;
    const [reply] = await tx
      .insert(supplierReplies)
      .values({
        tenantId: context.tenantId,
        orderId: context.orderId,
        exchangeMessageId: context.messageId,
        authorName: data.authorName,
        authorEmail: data.authorEmail,
        availability: data.availability,
        comment: data.comment,
        leadTimeDays: data.leadTimeDays,
        proposedTotalXof: data.proposedTotalXof,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
        attachmentSize: attachment?.size ?? null,
        attachmentData: attachment?.data ?? null,
      })
      .returning({ id: supplierReplies.id });
    if (!reply) {
      throw new ExchangeError("Réponse non enregistrée.");
    }

    await recordDocumentEvent(tx, {
      tenantId: context.tenantId,
      actorUserId: null,
      entityType: "purchase_order",
      entityId: context.orderId,
      event: {
        type: "purchase_order.supplier_reply",
        key: reply.id,
        number: context.orderNumber,
        availability: data.availability,
      },
    });

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: null,
      action: "exchange.reply.received",
      entityType: "supplier_reply",
      entityId: reply.id,
      details: {
        exchangeMessageId: context.messageId,
        orderId: context.orderId,
        orderNumber: context.orderNumber,
        availability: data.availability,
        hasAttachment: Boolean(attachment),
        commentLength: data.comment?.length ?? 0,
      },
    });

    return { replyId: reply.id, orderId: context.orderId };
  });
}

export async function listSupplierReplies(
  db: Database,
  input: { readonly tenantId: string; readonly orderId: string },
): Promise<readonly SupplierReplySummary[]> {
  return db
    .select({
      id: supplierReplies.id,
      exchangeMessageId: supplierReplies.exchangeMessageId,
      authorName: supplierReplies.authorName,
      authorEmail: supplierReplies.authorEmail,
      availability: supplierReplies.availability,
      comment: supplierReplies.comment,
      leadTimeDays: supplierReplies.leadTimeDays,
      proposedTotalXof: supplierReplies.proposedTotalXof,
      attachmentName: supplierReplies.attachmentName,
      attachmentSize: supplierReplies.attachmentSize,
      createdAt: supplierReplies.createdAt,
    })
    .from(supplierReplies)
    .where(
      and(eq(supplierReplies.tenantId, input.tenantId), eq(supplierReplies.orderId, input.orderId)),
    )
    .orderBy(desc(supplierReplies.createdAt));
}

export async function getSupplierReplyAttachment(
  db: Database,
  input: { readonly tenantId: string; readonly replyId: string },
): Promise<{ readonly name: string; readonly mime: string; readonly data: Uint8Array } | null> {
  const [row] = await db
    .select({
      name: supplierReplies.attachmentName,
      mime: supplierReplies.attachmentMime,
      data: supplierReplies.attachmentData,
    })
    .from(supplierReplies)
    .where(and(eq(supplierReplies.tenantId, input.tenantId), eq(supplierReplies.id, input.replyId)))
    .limit(1);
  if (!row?.name || !row.mime || !row.data) {
    return null;
  }
  return { name: row.name, mime: row.mime, data: row.data };
}
