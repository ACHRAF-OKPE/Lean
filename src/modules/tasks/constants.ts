import type { TaskPriority, TaskRelatedEntityType, TaskStatus } from "@/db/schema";

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const satisfies readonly TaskStatus[];

export const TASK_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly TaskPriority[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Ouverte",
  in_progress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const TASK_RELATED_LABELS: Record<TaskRelatedEntityType, string> = {
  partner: "Tiers",
  purchase_order: "Commande fournisseur",
  sales_order: "Commande client",
  invoice: "Facture",
};

export const TASK_RELATED_PATHS: Record<TaskRelatedEntityType, string> = {
  partner: "/tiers",
  purchase_order: "/achats",
  sales_order: "/ventes",
  invoice: "/factures",
};

export const TASK_MAX_TITLE = 160;
export const TASK_MAX_DESCRIPTION = 4000;
export const TASK_PAGE_SIZE = 100;
export const TASK_ENTITY_PAGE_SIZE = 20;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskRelatedEntityType(value: unknown): value is TaskRelatedEntityType {
  return (
    typeof value === "string" &&
    (Object.keys(TASK_RELATED_LABELS) as readonly string[]).includes(value)
  );
}

export function isTaskClosed(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

export function isTaskOverdue(
  task: { readonly status: TaskStatus; readonly dueDate: string | null },
  today: string,
): boolean {
  return Boolean(task.dueDate && task.dueDate < today && !isTaskClosed(task.status));
}

export function relatedHref(entityType: TaskRelatedEntityType, entityId: string): string {
  return `${TASK_RELATED_PATHS[entityType]}/${entityId}`;
}
