import type { DiscussionEntityType } from "@/db/schema";
import { COMMENT_MAX_LENGTH, MENTION_MAX, isDiscussionEntityType } from "./constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiscussionCommentRaw {
  readonly entityType: unknown;
  readonly entityId: unknown;
  readonly body: unknown;
  readonly mentionedUserIds: readonly unknown[];
}

export interface DiscussionCommentData {
  readonly entityType: DiscussionEntityType;
  readonly entityId: string;
  readonly body: string;
  readonly mentionedUserIds: readonly string[];
}

export interface DiscussionValidation<T> {
  readonly data: T;
  readonly errors: readonly string[];
}

export function validateDiscussionComment(
  raw: DiscussionCommentRaw,
): DiscussionValidation<DiscussionCommentData> {
  const errors: string[] = [];

  if (!isDiscussionEntityType(raw.entityType)) {
    errors.push("Type de document inconnu.");
  }

  const entityId = typeof raw.entityId === "string" ? raw.entityId.trim() : "";
  if (!UUID_PATTERN.test(entityId)) {
    errors.push("Document invalide.");
  }

  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) {
    errors.push("Le commentaire est vide.");
  } else if (body.length > COMMENT_MAX_LENGTH) {
    errors.push(`Le commentaire dépasse ${COMMENT_MAX_LENGTH} caractères.`);
  }

  const mentionedUserIds: string[] = [];
  const seen = new Set<string>();
  for (const value of raw.mentionedUserIds) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      errors.push("Destinataire mentionné invalide.");
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    mentionedUserIds.push(value);
  }
  if (mentionedUserIds.length > MENTION_MAX) {
    errors.push(`Au plus ${MENTION_MAX} personnes peuvent être mentionnées.`);
  }

  return {
    data: {
      entityType: (isDiscussionEntityType(raw.entityType)
        ? raw.entityType
        : "partner") as DiscussionEntityType,
      entityId,
      body,
      mentionedUserIds,
    },
    errors,
  };
}
