import type { DiscussionEntityType } from "@/db/schema";

export const DISCUSSION_ENTITY_TYPES = [
  "partner",
  "purchase_order",
  "sales_order",
  "invoice",
  "task",
] as const satisfies readonly DiscussionEntityType[];

export const DISCUSSION_ENTITY_LABELS: Record<DiscussionEntityType, string> = {
  partner: "Tiers",
  purchase_order: "Commande fournisseur",
  sales_order: "Commande client",
  invoice: "Facture",
  task: "Tâche",
};

export const MENTION_NOTIFICATION_TITLES: Record<DiscussionEntityType, string> = {
  partner: "Mention sur un tiers",
  purchase_order: "Mention sur une commande fournisseur",
  sales_order: "Mention sur une commande client",
  invoice: "Mention sur une facture",
  task: "Mention sur une tâche",
};

export const COMMENT_MAX_LENGTH = 4000;
export const MENTION_MAX = 50;
export const DISCUSSION_PAGE_SIZE = 50;
export const NOTIFICATION_PAGE_SIZE = 100;
export const NOTIFICATION_BODY_MAX_LENGTH = 500;

export function isDiscussionEntityType(value: unknown): value is DiscussionEntityType {
  return (
    typeof value === "string" && (DISCUSSION_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export function entityLabel(entityType: DiscussionEntityType): string {
  return DISCUSSION_ENTITY_LABELS[entityType];
}
