"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import {
  listMentionableMembers,
  markAllNotificationsRead,
  markNotificationRead,
  postDiscussionComment,
} from "@/modules/discussion/queries";
import { DiscussionError } from "@/modules/discussion/errors";
import { validateDiscussionComment } from "@/modules/discussion/validation";
import { formatTaggedBody } from "@/modules/discussion/tags";
import { detectMentionsFromText } from "@/modules/discussion/mentions";
import { discussionPath } from "./paths";
import type { DiscussionFormState } from "./form-state";

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function postCommentAction(
  _state: DiscussionFormState,
  formData: FormData,
): Promise<DiscussionFormState> {
  const session = await requirePermission("data.write");
  const db = getDb();

  const rawBody = text(formData, "body") ?? "";
  const rawTag = text(formData, "tag");
  const explicitMentionIds = formData
    .getAll("mentionedUserIds")
    .filter((value): value is string => typeof value === "string");

  // Détection automatique des mentions dans le corps du texte
  const members = await listMentionableMembers(db, session.tenantId);
  const autoMentionedIds = detectMentionsFromText(rawBody, members);
  const combinedMentionIds = Array.from(new Set([...explicitMentionIds, ...autoMentionedIds]));

  const validation = validateDiscussionComment({
    entityType: text(formData, "entityType"),
    entityId: text(formData, "entityId"),
    body: rawBody,
    mentionedUserIds: combinedMentionIds,
    tag: rawTag,
  });

  if (validation.errors.length > 0) {
    return { errors: validation.errors, ok: false };
  }

  const finalBody = formatTaggedBody(validation.data.body, validation.data.tag);

  try {
    await postDiscussionComment(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        entityType: validation.data.entityType,
        entityId: validation.data.entityId,
        body: finalBody,
        mentionedUserIds: validation.data.mentionedUserIds,
      },
    });
  } catch (error) {
    if (error instanceof DiscussionError) {
      return { errors: [error.message], ok: false };
    }
    throw error;
  }

  revalidatePath(discussionPath(validation.data.entityType, validation.data.entityId));
  return { errors: [], ok: true };
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const session = await requirePermission("data.read");
  const notificationId = text(formData, "notificationId");
  if (notificationId) {
    await markNotificationRead(getDb(), {
      tenantId: session.tenantId,
      userId: session.userId,
      notificationId,
    });
  }
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await requirePermission("data.read");
  await markAllNotificationsRead(getDb(), {
    tenantId: session.tenantId,
    userId: session.userId,
  });
  revalidatePath("/notifications");
}
