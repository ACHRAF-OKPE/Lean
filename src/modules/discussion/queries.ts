import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  discussionMentions,
  discussionMessages,
  invoices,
  memberships,
  notifications,
  partners,
  purchaseOrders,
  salesOrders,
  users,
  type DiscussionEntityType,
  type DiscussionMessageKind,
  type NotificationKind,
} from "@/db/schema";
import {
  DISCUSSION_PAGE_SIZE,
  MENTION_NOTIFICATION_TITLES,
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_PAGE_SIZE,
} from "./constants";
import { DiscussionError } from "./errors";
import { describeDocumentEvent, type DocumentEventInput } from "./events";
import { validateDiscussionComment, type DiscussionCommentRaw } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DiscussionMessageSummary {
  readonly id: string;
  readonly kind: DiscussionMessageKind;
  readonly body: string;
  readonly eventType: string | null;
  readonly authorName: string | null;
  readonly createdAt: Date;
  readonly mentions: readonly { readonly userId: string; readonly name: string }[];
}

export interface MentionableMember {
  readonly userId: string;
  readonly name: string;
  readonly role: "owner" | "admin" | "member";
}

export interface NotificationSummary {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly entityType: DiscussionEntityType;
  readonly entityId: string;
  readonly messageId: string;
  readonly actorName: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= NOTIFICATION_BODY_MAX_LENGTH
    ? compact
    : `${compact.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1)}…`;
}

async function assertEntity(
  tx: Transaction,
  tenantId: string,
  entityType: DiscussionEntityType,
  entityId: string,
): Promise<void> {
  let found = false;
  switch (entityType) {
    case "partner": {
      const [row] = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(and(eq(partners.tenantId, tenantId), eq(partners.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "purchase_order": {
      const [row] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "sales_order": {
      const [row] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "invoice": {
      const [row] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
  }

  if (!found) {
    throw new DiscussionError("Document introuvable dans cet espace de travail.");
  }
}

export async function postDiscussionComment(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: DiscussionCommentRaw;
  },
): Promise<{ readonly messageId: string }> {
  const validation = validateDiscussionComment(input.raw);
  if (validation.errors.length > 0) {
    throw new DiscussionError(validation.errors[0] ?? "Commentaire invalide.");
  }
  const data = validation.data;

  return db.transaction(async (tx) => {
    await assertEntity(tx, input.tenantId, data.entityType, data.entityId);

    if (data.mentionedUserIds.length > 0) {
      const members = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            inArray(memberships.userId, [...data.mentionedUserIds]),
          ),
        );
      if (members.length !== data.mentionedUserIds.length) {
        throw new DiscussionError(
          "Un destinataire mentionné n'appartient pas à cet espace de travail.",
        );
      }
    }

    const [message] = await tx
      .insert(discussionMessages)
      .values({
        tenantId: input.tenantId,
        entityType: data.entityType,
        entityId: data.entityId,
        kind: "comment",
        body: data.body,
        authorUserId: input.actorUserId,
      })
      .returning({ id: discussionMessages.id });
    if (!message) {
      throw new DiscussionError("Commentaire non enregistré.");
    }

    if (data.mentionedUserIds.length > 0) {
      await tx.insert(discussionMentions).values(
        data.mentionedUserIds.map((mentionedUserId) => ({
          tenantId: input.tenantId,
          messageId: message.id,
          mentionedUserId,
        })),
      );
    }

    const recipients = data.mentionedUserIds.filter((userId) => userId !== input.actorUserId);
    if (recipients.length > 0) {
      await tx.insert(notifications).values(
        recipients.map((userId) => ({
          tenantId: input.tenantId,
          userId,
          kind: "mention" as const,
          title: MENTION_NOTIFICATION_TITLES[data.entityType],
          body: excerpt(data.body),
          entityType: data.entityType,
          entityId: data.entityId,
          messageId: message.id,
          actorUserId: input.actorUserId,
          eventKey: `mention:${message.id}`,
        })),
      );
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "discussion.comment.create",
      entityType: data.entityType,
      entityId: data.entityId,
      details: { messageId: message.id, mentions: data.mentionedUserIds.length },
    });

    return { messageId: message.id };
  });
}

export async function recordDocumentEvent(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string | null;
    readonly entityType: DiscussionEntityType;
    readonly entityId: string;
    readonly event: Omit<DocumentEventInput, "entityType">;
  },
): Promise<string | null> {
  const descriptor = describeDocumentEvent({
    ...input.event,
    entityType: input.entityType,
  });

  const [message] = await tx
    .insert(discussionMessages)
    .values({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      kind: "event",
      body: descriptor.body,
      eventType: descriptor.type,
      eventKey: descriptor.eventKey,
      authorUserId: input.actorUserId,
    })
    .onConflictDoNothing()
    .returning({ id: discussionMessages.id });

  if (!message) {
    return null;
  }

  const members = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.tenantId, input.tenantId));

  if (members.length > 0) {
    await tx
      .insert(notifications)
      .values(
        members.map((member) => ({
          tenantId: input.tenantId,
          userId: member.userId,
          kind: "event" as const,
          title: descriptor.title,
          body: descriptor.body,
          entityType: input.entityType,
          entityId: input.entityId,
          messageId: message.id,
          actorUserId: input.actorUserId,
          eventKey: `event:${message.id}`,
        })),
      )
      .onConflictDoNothing();
  }

  return message.id;
}

export async function listDiscussionMessages(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly entityType: DiscussionEntityType;
    readonly entityId: string;
    readonly limit?: number;
  },
): Promise<readonly DiscussionMessageSummary[]> {
  const rows = await db
    .select({
      id: discussionMessages.id,
      kind: discussionMessages.kind,
      body: discussionMessages.body,
      eventType: discussionMessages.eventType,
      authorName: users.name,
      createdAt: discussionMessages.createdAt,
    })
    .from(discussionMessages)
    .leftJoin(users, eq(users.id, discussionMessages.authorUserId))
    .where(
      and(
        eq(discussionMessages.tenantId, input.tenantId),
        eq(discussionMessages.entityType, input.entityType),
        eq(discussionMessages.entityId, input.entityId),
      ),
    )
    .orderBy(desc(discussionMessages.createdAt))
    .limit(input.limit ?? DISCUSSION_PAGE_SIZE);

  const ordered = [...rows].reverse();
  if (ordered.length === 0) {
    return [];
  }

  const mentionRows = await db
    .select({
      messageId: discussionMentions.messageId,
      userId: discussionMentions.mentionedUserId,
      name: users.name,
    })
    .from(discussionMentions)
    .innerJoin(users, eq(users.id, discussionMentions.mentionedUserId))
    .where(
      and(
        eq(discussionMentions.tenantId, input.tenantId),
        inArray(
          discussionMentions.messageId,
          ordered.map((row) => row.id),
        ),
      ),
    );

  const mentionsByMessage = new Map<string, { userId: string; name: string }[]>();
  for (const mention of mentionRows) {
    const list = mentionsByMessage.get(mention.messageId) ?? [];
    list.push({ userId: mention.userId, name: mention.name });
    mentionsByMessage.set(mention.messageId, list);
  }

  return ordered.map((row) => ({
    ...row,
    mentions: mentionsByMessage.get(row.id) ?? [],
  }));
}

export async function listMentionableMembers(
  db: Database,
  tenantId: string,
): Promise<readonly MentionableMember[]> {
  return db
    .select({
      userId: memberships.userId,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(users.name));
}

export async function listNotifications(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly limit?: number;
  },
): Promise<readonly NotificationSummary[]> {
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      messageId: notifications.messageId,
      actorName: users.name,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorUserId))
    .where(and(eq(notifications.tenantId, input.tenantId), eq(notifications.userId, input.userId)))
    .orderBy(desc(notifications.createdAt))
    .limit(input.limit ?? NOTIFICATION_PAGE_SIZE);
}

export async function countUnreadNotifications(
  db: Database,
  input: { readonly tenantId: string; readonly userId: string },
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, input.tenantId),
        eq(notifications.userId, input.userId),
        isNull(notifications.readAt),
      ),
    );
  return row?.value ?? 0;
}

export async function markNotificationRead(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly notificationId: string;
  },
): Promise<boolean> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, input.tenantId),
        eq(notifications.userId, input.userId),
        eq(notifications.id, input.notificationId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return updated.length > 0;
}

export async function markAllNotificationsRead(
  db: Database,
  input: { readonly tenantId: string; readonly userId: string },
): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, input.tenantId),
        eq(notifications.userId, input.userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return updated.length;
}
