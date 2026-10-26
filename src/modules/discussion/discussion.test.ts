import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, discussionMentions, discussionMessages, notifications } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  transitionPurchaseOrder,
} from "@/modules/purchases/queries";
import { createDelivery } from "@/modules/sales/deliveries";
import { createInvoice, validateInvoice } from "@/modules/sales/invoices";
import { createInvoicePayment } from "@/modules/sales/payments";
import { createSalesOrder, getSalesOrder, transitionSalesOrder } from "@/modules/sales/queries";
import { cancelReception, createReception } from "@/modules/stock/receptions";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCollaborationTenant, type CollaborationTenant } from "@/test/collaboration";
import {
  countUnreadNotifications,
  listDiscussionMessages,
  listMentionableMembers,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  postDiscussionComment,
  recordDocumentEvent,
} from "./queries";
import { validateDiscussionComment } from "./validation";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

function setup(label: string): Promise<CollaborationTenant> {
  return seedCollaborationTenant(db, label);
}

const PRODUCT_LINES = (articleId: string) => [{ articleId, qty: "2", unitPriceXof: 1000 }];

async function draftPurchaseOrder(tenant: CollaborationTenant): Promise<string> {
  const order = await createPurchaseOrder(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    data: {
      supplierId: tenant.supplierId,
      expectedReceiptDate: "",
      externalReference: "",
      notes: "",
      lines: PRODUCT_LINES(tenant.productId),
    },
  });
  return order.id;
}

async function commentMessages(
  tenant: CollaborationTenant,
  entityType: "partner" | "purchase_order" | "sales_order" | "invoice",
  entityId: string,
) {
  return listDiscussionMessages(db, {
    tenantId: tenant.tenantId,
    entityType,
    entityId,
  });
}

describe("COL-001 — fil de discussion interne", () => {
  it("COL-001 enregistre un commentaire signé, horodaté et audité sans son texte", async () => {
    const tenant = await setup("col-001-append");
    const result = await postDiscussionComment(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        entityType: "partner",
        entityId: tenant.supplierId,
        body: "  Merci de confirmer le tarif 2027.  ",
        mentionedUserIds: [],
      },
    });

    const messages = await commentMessages(tenant, "partner", tenant.supplierId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(result.messageId);
    expect(messages[0]?.kind).toBe("comment");
    expect(messages[0]?.body).toBe("Merci de confirmer le tarif 2027.");
    expect(messages[0]?.authorName).toBe("Awa Test");

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "discussion.comment.create"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entityType).toBe("partner");
    expect(audit[0]?.entityId).toBe(tenant.supplierId);
    expect((audit[0]?.details as { mentions?: number }).mentions).toBe(0);
    expect(JSON.stringify(audit[0]?.details)).not.toContain("Merci de confirmer");
  });

  it("COL-001 refuse un commentaire vide ou trop long", async () => {
    const entityId = randomUUID();
    expect(
      validateDiscussionComment({
        entityType: "partner",
        entityId,
        body: "   ",
        mentionedUserIds: [],
      }).errors,
    ).toContain("Le commentaire est vide.");
    expect(
      validateDiscussionComment({
        entityType: "partner",
        entityId,
        body: "x".repeat(4001),
        mentionedUserIds: [],
      }).errors[0],
    ).toMatch(/4000/);
    expect(
      validateDiscussionComment({
        entityType: "partner",
        entityId,
        body: "x".repeat(4000),
        mentionedUserIds: [],
      }).errors,
    ).toHaveLength(0);
  });

  it("COL-001 refuse un document inconnu, d'un autre type ou d'un autre espace", async () => {
    const tenant = await setup("col-001-isolation");
    const raw = {
      entityType: "partner" as const,
      entityId: randomUUID(),
      body: "Commentaire refusé.",
      mentionedUserIds: [],
    };

    await expect(
      postDiscussionComment(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw,
      }),
    ).rejects.toThrow(/introuvable/);

    await expect(
      postDiscussionComment(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { ...raw, entityType: "invoice", entityId: tenant.supplierId },
      }),
    ).rejects.toThrow(/introuvable/);

    await expect(
      postDiscussionComment(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { ...raw, entityId: tenant.otherPartnerId },
      }),
    ).rejects.toThrow(/introuvable/);

    expect(
      await db
        .select({ id: discussionMessages.id })
        .from(discussionMessages)
        .where(eq(discussionMessages.tenantId, tenant.tenantId)),
    ).toHaveLength(0);
  });
});

describe("COL-002 — mentions", () => {
  it("COL-002 déduplique les mentions et notifie les seuls destinataires distincts", async () => {
    const tenant = await setup("col-002-mentions");
    const result = await postDiscussionComment(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        entityType: "partner",
        entityId: tenant.supplierId,
        body: "Moussa, peux-tu vérifier ce tarif ?",
        mentionedUserIds: [tenant.memberUserId, tenant.memberUserId, tenant.userId],
      },
    });

    const mentions = await db
      .select()
      .from(discussionMentions)
      .where(eq(discussionMentions.tenantId, tenant.tenantId));
    expect(mentions).toHaveLength(2);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(tenant.memberUserId);
    expect(rows[0]?.kind).toBe("mention");
    expect(rows[0]?.messageId).toBe(result.messageId);
    expect(rows[0]?.eventKey).toBe(`mention:${result.messageId}`);
    expect(rows[0]?.title).toBe("Mention sur un tiers");

    expect(
      await countUnreadNotifications(db, {
        tenantId: tenant.tenantId,
        userId: tenant.memberUserId,
      }),
    ).toBe(1);
    expect(
      await countUnreadNotifications(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
      }),
    ).toBe(0);
  });

  it("COL-002 refuse une mention hors espace sans écriture partielle", async () => {
    const tenant = await setup("col-002-foreign");
    await expect(
      postDiscussionComment(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          entityType: "partner",
          entityId: tenant.supplierId,
          body: "Mention interdite.",
          mentionedUserIds: [tenant.otherTenantUserId],
        },
      }),
    ).rejects.toThrow(/espace de travail/);

    expect(
      await db
        .select({ id: discussionMessages.id })
        .from(discussionMessages)
        .where(eq(discussionMessages.tenantId, tenant.tenantId)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.tenantId, tenant.tenantId)),
    ).toHaveLength(0);
  });

  it("COL-002 borne le nombre de mentions à 50", async () => {
    const errors = validateDiscussionComment({
      entityType: "partner",
      entityId: randomUUID(),
      body: "Trop de mentions.",
      mentionedUserIds: Array.from({ length: 51 }, () => randomUUID()),
    }).errors;
    expect(errors.join(" ")).toMatch(/50/);
  });
});

describe("COL-003 — évènements structurants", () => {
  it("COL-003 inscrit les transitions d'une commande fournisseur avec leur numéro", async () => {
    const tenant = await setup("col-003-purchase");
    const orderId = await draftPurchaseOrder(tenant);
    expect(await commentMessages(tenant, "purchase_order", orderId)).toHaveLength(0);

    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "request",
    });
    let messages = await commentMessages(tenant, "purchase_order", orderId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("event");
    expect(messages[0]?.eventType).toBe("purchase_order.requested");
    expect(messages[0]?.body).toMatch(/demandée/);

    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "confirm",
    });
    messages = await commentMessages(tenant, "purchase_order", orderId);
    expect(messages).toHaveLength(2);
    const confirmed = messages.find((message) => message.eventType === "purchase_order.confirmed");
    expect(confirmed?.body).toMatch(/confirmée/);
    expect(confirmed?.body).toMatch(/CMD-/);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.userId))).toEqual(
      new Set([tenant.userId, tenant.memberUserId]),
    );
    expect(rows.every((row) => row.kind === "event")).toBe(true);
  });

  it("COL-003 rend le rejeu d'un évènement idempotent", async () => {
    const tenant = await setup("col-003-idempotent");
    const orderId = await draftPurchaseOrder(tenant);
    const input = {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      entityType: "purchase_order" as const,
      entityId: orderId,
      event: {
        type: "purchase_order.requested" as const,
        key: "replay-guard",
        number: null,
      },
    };

    const first = await db.transaction((tx) => recordDocumentEvent(tx, input));
    const second = await db.transaction((tx) => recordDocumentEvent(tx, input));
    expect(first).toBeTruthy();
    expect(second).toBeNull();

    const messages = await commentMessages(tenant, "purchase_order", orderId);
    expect(messages).toHaveLength(1);
    expect(
      await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.tenantId, tenant.tenantId)),
    ).toHaveLength(2);
  });

  it("COL-003 trace la réception puis son annulation", async () => {
    const tenant = await setup("col-003-reception");
    const orderId = await draftPurchaseOrder(tenant);
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "request",
    });
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "confirm",
    });

    const detail = await getPurchaseOrder(db, { tenantId: tenant.tenantId, orderId });
    const lineId = detail?.lines.find((line) => line.articleType === "product")?.id;
    if (!lineId) {
      throw new Error("Ligne produit absente.");
    }

    const reception = await createReception(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      locationId: tenant.locationId,
      receivedDate: todayIsoDate(),
      notes: null,
      lines: [{ orderLineId: lineId, qty: "1" }],
    });
    await cancelReception(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      receptionId: reception.receptionId,
    });

    const messages = await commentMessages(tenant, "purchase_order", orderId);
    const types = messages.map((message) => message.eventType);
    expect(types).toContain("purchase_order.received");
    expect(types).toContain("purchase_order.reception_cancelled");
    expect(
      messages.find((message) => message.eventType === "purchase_order.received")?.body,
    ).toContain(reception.number);
  });

  it("COL-003 trace livraison, validation de facture et paiement", async () => {
    const tenant = await setup("col-003-sales");
    const created = await createSalesOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: {
        customerId: tenant.customerId,
        expectedDeliveryDate: "",
        externalReference: "",
        incoterm: "",
        notes: "",
        lines: [{ articleId: tenant.productId, qty: "2", unitPriceXof: 1500 }],
      },
    });
    await transitionSalesOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId: created.id,
      action: "confirm",
    });
    const detail = await getSalesOrder(db, {
      tenantId: tenant.tenantId,
      orderId: created.id,
    });
    const lineId = detail?.lines[0]?.id;
    if (!lineId) {
      throw new Error("Ligne de vente absente.");
    }

    const delivery = await createDelivery(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId: created.id,
      locationId: tenant.locationId,
      deliveredDate: todayIsoDate(),
      notes: null,
      lines: [{ orderLineId: lineId, qty: "1" }],
    });

    const draft = await createInvoice(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId: created.id,
      invoiceDate: todayIsoDate(),
      dueDate: todayIsoDate(),
      notes: null,
      lines: [{ orderLineId: lineId, qty: "1" }],
    });
    const invoice = await validateInvoice(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      invoiceId: draft.invoiceId,
    });
    await createInvoicePayment(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      invoiceId: draft.invoiceId,
      amountXof: 500,
      paidDate: todayIsoDate(),
      method: "transfer",
      reference: null,
    });

    const orderMessages = await commentMessages(tenant, "sales_order", created.id);
    const orderTypes = orderMessages.map((message) => message.eventType);
    expect(orderTypes).toContain("sales_order.confirmed");
    expect(orderTypes).toContain("sales_order.delivered");
    expect(
      orderMessages.find((message) => message.eventType === "sales_order.delivered")?.body,
    ).toContain(delivery.number);

    const invoiceMessages = await commentMessages(tenant, "invoice", draft.invoiceId);
    expect(new Set(invoiceMessages.map((message) => message.eventType))).toEqual(
      new Set(["invoice.validated", "invoice.payment"]),
    );
    const validation = invoiceMessages.find((message) => message.eventType === "invoice.validated");
    expect(validation?.body).toContain(invoice.number);
    expect(validation?.body).toContain(formatXof(draft.exTaxTotal));
    expect(
      invoiceMessages.find((message) => message.eventType === "invoice.payment")?.body,
    ).toContain(formatXof(500));
  });
});

describe("COL-004 — notifications", () => {
  it("COL-004 notifie tous les membres, auteur compris, une fois par évènement", async () => {
    const tenant = await setup("col-004-recipients");
    const orderId = await draftPurchaseOrder(tenant);
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "request",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "event")).toBe(true);
    expect(rows.every((row) => row.eventKey.startsWith("event:"))).toBe(true);
    expect(rows.some((row) => row.userId === tenant.userId)).toBe(true);
    expect(rows.some((row) => row.userId === tenant.memberUserId)).toBe(true);
  });

  it("COL-004 borne le texte de notification à 500 caractères", async () => {
    const tenant = await setup("col-004-excerpt");
    const body = "a".repeat(600);
    await postDiscussionComment(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        entityType: "partner",
        entityId: tenant.supplierId,
        body,
        mentionedUserIds: [tenant.memberUserId],
      },
    });

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    expect(row?.body.length).toBe(500);
    expect(row?.body.endsWith("…")).toBe(true);
  });

  it("COL-004 isole la lecture et le marquage par utilisateur, de façon idempotente", async () => {
    const tenant = await setup("col-004-read");
    const orderId = await draftPurchaseOrder(tenant);
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "request",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    const memberRow = rows.find((row) => row.userId === tenant.memberUserId);
    const ownerRow = rows.find((row) => row.userId === tenant.userId);
    if (!memberRow || !ownerRow) {
      throw new Error("Notifications de test absentes.");
    }

    expect(
      await markNotificationRead(db, {
        tenantId: tenant.tenantId,
        userId: tenant.memberUserId,
        notificationId: memberRow.id,
      }),
    ).toBe(true);
    expect(
      await markNotificationRead(db, {
        tenantId: tenant.tenantId,
        userId: tenant.memberUserId,
        notificationId: memberRow.id,
      }),
    ).toBe(false);
    expect(
      await markNotificationRead(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        notificationId: memberRow.id,
      }),
    ).toBe(false);

    expect(
      await countUnreadNotifications(db, {
        tenantId: tenant.tenantId,
        userId: tenant.memberUserId,
      }),
    ).toBe(0);
    expect(
      await countUnreadNotifications(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
      }),
    ).toBe(1);

    expect(
      await markAllNotificationsRead(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
      }),
    ).toBe(1);
    expect(
      await countUnreadNotifications(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
      }),
    ).toBe(0);
  });

  it("COL-004 ne franchit ni la frontière du tenant ni celle de l'utilisateur", async () => {
    const tenant = await setup("col-004-isolation");
    const orderId = await draftPurchaseOrder(tenant);
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId,
      action: "request",
    });
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));

    expect(
      await listNotifications(db, {
        tenantId: tenant.otherTenantId,
        userId: tenant.otherTenantUserId,
      }),
    ).toHaveLength(0);
    expect(
      await markNotificationRead(db, {
        tenantId: tenant.otherTenantId,
        userId: tenant.otherTenantUserId,
        notificationId: row!.id,
      }),
    ).toBe(false);
  });
});

describe("COL-005 — bandeau et périmètre", () => {
  it("COL-005 limite la boîte aux 100 dernières notifications", async () => {
    const tenant = await setup("col-005-limit");
    const result = await postDiscussionComment(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        entityType: "partner",
        entityId: tenant.supplierId,
        body: "Base des notifications de volume.",
        mentionedUserIds: [],
      },
    });

    const base = Date.now() - 200_000;
    await db.insert(notifications).values(
      Array.from({ length: 105 }, (_, index) => ({
        tenantId: tenant.tenantId,
        userId: tenant.memberUserId,
        kind: "event" as const,
        title: `Volume ${index}`,
        body: `Notification ${index}`,
        entityType: "partner" as const,
        entityId: tenant.supplierId,
        messageId: result.messageId,
        actorUserId: tenant.userId,
        eventKey: `volume:${index}`,
        createdAt: new Date(base + index * 1000),
      })),
    );

    const list = await listNotifications(db, {
      tenantId: tenant.tenantId,
      userId: tenant.memberUserId,
    });
    expect(list).toHaveLength(100);
    expect(list[0]?.title).toBe("Volume 104");
    expect(list[99]?.title).toBe("Volume 5");
  });

  it("COL-005 limite les mentions aux membres de l'espace", async () => {
    const tenant = await setup("col-005-members");
    const members = await listMentionableMembers(db, tenant.tenantId);
    expect(members.map((member) => member.userId).sort()).toEqual(
      [tenant.userId, tenant.memberUserId].sort(),
    );
    expect(members.some((member) => member.userId === tenant.otherTenantUserId)).toBe(false);
  });
});
