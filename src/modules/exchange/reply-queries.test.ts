import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  auditEvents,
  discussionMessages,
  exchangeMessages,
  memberships,
  notifications,
  supplierReplies,
  users,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedExchangeTenant, type ExchangeTenant } from "@/test/exchange";
import type { OutgoingMail, TransportFactory } from "./mailer";
import { saveEmailAccount, sendPurchaseExchange } from "./queries";
import {
  createSupplierReply,
  getSupplierReplyAttachment,
  getSupplierReplyContext,
  listSupplierReplies,
} from "./reply-queries";
import { hashReplyToken, validateSupplierReply, type SupplierReplyData } from "./replies";

process.env.LEAN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

const APP_URL = "https://lean.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

interface Recorder {
  readonly factory: TransportFactory;
  readonly sent: OutgoingMail[];
  fail: Error | null;
}

function recorder(fail: Error | null = null): Recorder {
  const state: Recorder = {
    sent: [],
    fail,
    factory: () => ({
      async verify() {
        if (state.fail) {
          throw state.fail;
        }
      },
      async send(message) {
        if (state.fail) {
          throw state.fail;
        }
        state.sent.push(message);
        return { messageId: `<${state.sent.length}@lean.test>` };
      },
    }),
  };
  return state;
}

interface ReplyTenant extends ExchangeTenant {
  readonly memberUserId: string;
}

let counter = 0;

async function setup(label: string): Promise<ReplyTenant> {
  counter += 1;
  const tenant = await seedExchangeTenant(db, `${label}-${counter}`);
  await db.insert(memberships).values({
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    role: "owner",
  });
  const [member] = await db
    .insert(users)
    .values({
      email: `reply-member-${counter}@test.local`,
      name: "Moussa Koffi",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });
  if (!member) {
    throw new Error("Membre de test non créé.");
  }
  await db.insert(memberships).values({
    tenantId: tenant.tenantId,
    userId: member.id,
    role: "member",
  });

  await saveEmailAccount(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    data: {
      name: "SMTP test",
      host: "smtp.lean.test",
      port: 587,
      security: "starttls",
      username: "achats@lean.test",
      fromName: "Lean Achats",
      fromAddress: "achats@lean.test",
      replyTo: null,
      active: true,
      passwordAction: "set",
      password: "secret-smtp-42",
    },
  });

  return { ...tenant, memberUserId: member.id };
}

async function sendRequest(
  tenant: ReplyTenant,
  transport: Recorder,
  orderId = tenant.requestedOrderId,
  type: "purchase_request" | "purchase_confirmation" = "purchase_request",
) {
  return sendPurchaseExchange(
    db,
    {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      senderName: "Awa Koné",
      orderId,
      type,
      templateId: null,
      recipient: "mariam@sahel.test",
      recipientName: "Mariam Traoré",
      subject: "",
      body: "",
      appUrl: APP_URL,
    },
    transport.factory,
  );
}

const TOKEN_PATTERN = /https:\/\/lean\.test\/repondre\/([A-Za-z0-9_-]{43})/;

function tokenFrom(value: string): string {
  const match = TOKEN_PATTERN.exec(value);
  if (!match?.[1]) {
    throw new Error("Jeton de réponse absent du message.");
  }
  return match[1];
}

function replyData(patch: Partial<SupplierReplyData> = {}): SupplierReplyData {
  return {
    authorName: "Mariam Traoré",
    authorEmail: "mariam@sahel.test",
    availability: "available",
    comment: null,
    leadTimeDays: null,
    proposedTotalXof: null,
    attachment: null,
    ...patch,
  };
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

describe("REP-001 — lien de réponse propre au message", () => {
  it("REP-001 ajoute le lien au message remis et ne stocke que l'empreinte", async () => {
    const tenant = await setup("rep-001");
    const transport = recorder();
    const result = await sendRequest(tenant, transport, tenant.requestedOrderId);
    const sent = transport.sent[0];
    expect(sent).toBeDefined();
    const token = tokenFrom(sent!.text);

    expect(sent!.html).toContain(`${APP_URL}/repondre/${token}`);
    expect(sent!.text).toContain("Répondre en ligne");

    const [row] = await db
      .select({
        hash: exchangeMessages.replyTokenHash,
        expiresAt: exchangeMessages.replyTokenExpiresAt,
        bodyText: exchangeMessages.bodyText,
        bodyHtml: exchangeMessages.bodyHtml,
      })
      .from(exchangeMessages)
      .where(eq(exchangeMessages.id, result.messageId));

    expect(row?.hash).toBe(hashReplyToken(token));
    expect(row?.hash).not.toBe(token);
    expect(row?.bodyText).toContain(token);
    expect(row?.bodyHtml).toContain(token);
    const days = (row!.expiresAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
  });

  it("REP-001 donne un jeton distinct à chaque envoi et ferme le lien d'un échec", async () => {
    const tenant = await setup("rep-001-echec");
    const first = recorder();
    const second = recorder();
    await sendRequest(tenant, first);
    await sendRequest(tenant, second);
    expect(tokenFrom(first.sent[0]!.text)).not.toBe(tokenFrom(second.sent[0]!.text));

    const failing = recorder(new Error("550 refusé"));
    await expect(sendRequest(tenant, failing)).rejects.toThrow(/Envoi refusé/);

    const [failed] = await db
      .select({ bodyText: exchangeMessages.bodyText })
      .from(exchangeMessages)
      .where(
        and(eq(exchangeMessages.tenantId, tenant.tenantId), eq(exchangeMessages.status, "failed")),
      )
      .orderBy(desc(exchangeMessages.createdAt))
      .limit(1);
    const failedToken = tokenFrom(failed!.bodyText);
    expect(await getSupplierReplyContext(db, failedToken)).toBeNull();
  });
});

describe("REP-002 — page publique minimale", () => {
  it("REP-002 rend la commande et le strict nécessaire pour un jeton remis", async () => {
    const tenant = await setup("rep-002");
    const transport = recorder();
    await sendRequest(tenant, transport, tenant.confirmedOrderId, "purchase_confirmation");
    const token = tokenFrom(transport.sent[0]!.text);

    const view = await getSupplierReplyContext(db, token);
    expect(view).not.toBeNull();
    expect(view!.orderId).toBe(tenant.confirmedOrderId);
    expect(view!.orderNumber).toMatch(/^CMD-\d{4}-\d{4}$/);
    expect(view!.companyName).toBe("Lean SARL");
    expect(view!.supplierName).toBe("Sahel Négoce SARL");
    expect(view!.recipient).toBe("mariam@sahel.test");
    expect(view!.recipientName).toBe("Mariam Traoré");
    expect(view!.totalXof).toBe(52000);
    expect(view!.lines.map((line) => line.name)).toEqual(["Café vert", "Transport maritime"]);
    expect(view!.replyCount).toBe(0);
  });

  it("REP-002 refuse un jeton inconnu, mal formé ou expiré, et isole les espaces", async () => {
    const tenant = await setup("rep-002-refus");
    const transport = recorder();
    await sendRequest(tenant, transport);
    const token = tokenFrom(transport.sent[0]!.text);

    expect(await getSupplierReplyContext(db, "a".repeat(43))).toBeNull();
    expect(await getSupplierReplyContext(db, "court")).toBeNull();

    await db
      .update(exchangeMessages)
      .set({ replyTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(exchangeMessages.replyTokenHash, hashReplyToken(token)));
    expect(await getSupplierReplyContext(db, token)).toBeNull();

    const other = await setup("rep-002-voisin");
    const otherTransport = recorder();
    await sendRequest(other, otherTransport, other.requestedOrderId);
    const otherToken = tokenFrom(otherTransport.sent[0]!.text);
    const otherView = await getSupplierReplyContext(db, otherToken);
    expect(otherView!.orderId).toBe(other.requestedOrderId);
    expect(otherView!.orderId).not.toBe(tenant.requestedOrderId);
  });
});

describe("REP-004 — réponse append-only, fil, notifications et audit", () => {
  it("REP-004 enregistre la réponse, notifie chaque membre et audit sans texte libre", async () => {
    const tenant = await setup("rep-004");
    const transport = recorder();
    await sendRequest(tenant, transport);
    const token = tokenFrom(transport.sent[0]!.text);

    const validation = validateSupplierReply(
      {
        authorName: "Mariam Traoré",
        authorEmail: "mariam@sahel.test",
        availability: "partial",
        comment: "10 sacs disponibles, le reste sous 7 jours.",
        leadTimeDays: "7",
        proposedTotalXof: "50000",
      },
      null,
    );
    expect(validation.errors).toEqual([]);

    const result = await createSupplierReply(db, { token, data: validation.data });
    expect(result.orderId).toBe(tenant.requestedOrderId);

    const [reply] = await db
      .select()
      .from(supplierReplies)
      .where(eq(supplierReplies.id, result.replyId));
    expect(reply?.availability).toBe("partial");
    expect(reply?.leadTimeDays).toBe(7);
    expect(reply?.proposedTotalXof).toBe(50000);

    const event = await db
      .select({ body: discussionMessages.body, eventType: discussionMessages.eventType })
      .from(discussionMessages)
      .where(
        and(
          eq(discussionMessages.tenantId, tenant.tenantId),
          eq(discussionMessages.entityType, "purchase_order"),
          eq(discussionMessages.entityId, tenant.requestedOrderId),
          eq(discussionMessages.eventType, "purchase_order.supplier_reply"),
        ),
      );
    expect(event).toHaveLength(1);
    expect(event[0]?.body).toContain("partiellement disponible");
    expect(event[0]?.body).not.toContain("10 sacs");

    const notices = await db
      .select({
        userId: notifications.userId,
        title: notifications.title,
        body: notifications.body,
      })
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.tenantId));
    expect(notices).toHaveLength(2);
    expect(new Set(notices.map((notice) => notice.userId))).toEqual(
      new Set([tenant.userId, tenant.memberUserId]),
    );
    for (const notice of notices) {
      expect(notice.title).toBe("Réponse fournisseur reçue");
      expect(notice.body).not.toContain("10 sacs");
    }

    const [audit] = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "exchange.reply.received"),
          eq(auditEvents.entityId, result.replyId),
        ),
      );
    expect(audit?.details).toMatchObject({
      availability: "partial",
      hasAttachment: false,
      commentLength: "10 sacs disponibles, le reste sous 7 jours.".length,
    });
    expect(JSON.stringify(audit?.details)).not.toContain("10 sacs");
  });

  it("REP-004 accepte dix réponses puis refuse la onzième sans écriture", async () => {
    const tenant = await setup("rep-004-limite");
    const transport = recorder();
    await sendRequest(tenant, transport);
    const token = tokenFrom(transport.sent[0]!.text);

    for (let index = 0; index < 10; index += 1) {
      await createSupplierReply(db, { token, data: replyData() });
    }

    await expect(createSupplierReply(db, { token, data: replyData() })).rejects.toThrow(
      /nombre maximal de réponses/,
    );

    const rows = await db
      .select({ id: supplierReplies.id })
      .from(supplierReplies)
      .where(eq(supplierReplies.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(10);
  });

  it("REP-004 refuse une écriture depuis un jeton inactif", async () => {
    const tenant = await setup("rep-004-jeton");
    await expect(
      createSupplierReply(db, { token: "a".repeat(43), data: replyData() }),
    ).rejects.toThrow(/n'est plus actif/);
    const rows = await db
      .select({ id: supplierReplies.id })
      .from(supplierReplies)
      .where(eq(supplierReplies.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(0);
  });
});

describe("REP-005 — consultation et pièce jointe", () => {
  it("REP-005 liste les réponses du tenant et protège la pièce jointe", async () => {
    const tenant = await setup("rep-005");
    const transport = recorder();
    await sendRequest(tenant, transport);
    const token = tokenFrom(transport.sent[0]!.text);

    const withFile = await createSupplierReply(db, {
      token,
      data: replyData({
        availability: "available",
        attachment: { name: "tarif.png", mime: "image/png", size: PNG.byteLength, data: PNG },
      }),
    });
    await createSupplierReply(db, {
      token,
      data: replyData({ availability: "unavailable", comment: "Rupture" }),
    });

    const list = await listSupplierReplies(db, {
      tenantId: tenant.tenantId,
      orderId: tenant.requestedOrderId,
    });
    expect(list).toHaveLength(2);
    const byId = new Map(list.map((entry) => [entry.id, entry]));
    expect(byId.get(withFile.replyId)?.attachmentName).toBe("tarif.png");
    expect(byId.get(withFile.replyId)?.attachmentSize).toBe(PNG.byteLength);
    expect(list.filter((entry) => entry.availability === "unavailable")).toHaveLength(1);

    const attachment = await getSupplierReplyAttachment(db, {
      tenantId: tenant.tenantId,
      replyId: withFile.replyId,
    });
    expect(attachment?.mime).toBe("image/png");
    expect(Array.from(attachment!.data)).toEqual(Array.from(PNG));

    const other = await setup("rep-005-voisin");
    expect(
      await getSupplierReplyAttachment(db, {
        tenantId: other.tenantId,
        replyId: withFile.replyId,
      }),
    ).toBeNull();
    expect(
      await listSupplierReplies(db, { tenantId: other.tenantId, orderId: tenant.requestedOrderId }),
    ).toEqual([]);
  });
});
