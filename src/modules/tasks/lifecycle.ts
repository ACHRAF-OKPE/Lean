import type { TaskStatus } from "@/db/schema";
import { TASK_STATUS_LABELS, isTaskClosed } from "./constants";

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["in_progress", "done", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: ["open"],
  cancelled: ["open"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function transitionError(from: TaskStatus, to: TaskStatus): string | null {
  if (from === to) {
    return `La tâche est déjà « ${TASK_STATUS_LABELS[from]} ».`;
  }
  if (!canTransition(from, to)) {
    return `Transition refusée : de « ${TASK_STATUS_LABELS[from]} » à « ${TASK_STATUS_LABELS[to]} ».`;
  }
  return null;
}

export function taskEditError(status: TaskStatus): string | null {
  return isTaskClosed(status) ? "Rouvrez la tâche avant de la modifier." : null;
}

export function completionPatch(
  status: TaskStatus,
  actorUserId: string,
  now: Date,
): { completedAt: Date | null; completedByUserId: string | null } {
  return status === "done"
    ? { completedAt: now, completedByUserId: actorUserId }
    : { completedAt: null, completedByUserId: null };
}
