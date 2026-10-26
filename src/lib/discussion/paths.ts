import type { DiscussionEntityType } from "@/db/schema";

export function discussionPath(entityType: DiscussionEntityType, entityId: string): string {
  switch (entityType) {
    case "partner":
      return `/tiers/${entityId}`;
    case "purchase_order":
      return `/achats/${entityId}`;
    case "sales_order":
      return `/ventes/${entityId}`;
    case "invoice":
      return `/factures/${entityId}`;
  }
}

export function discussionHref(entityType: DiscussionEntityType, entityId: string): string {
  return `${discussionPath(entityType, entityId)}#discussion`;
}
