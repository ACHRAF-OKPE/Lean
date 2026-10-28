import type { TaskPriority, TaskStatus } from "@/db/schema";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/modules/tasks/constants";

const BASE =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap";

const STATUS_CLASS: Record<TaskStatus, string> = {
  open: "border-line bg-canvas text-muted",
  in_progress: "border-brand/20 bg-brand-soft text-brand-strong",
  done: "border-brand/15 bg-brand-soft text-brand-strong",
  cancelled: "border-copper/20 bg-copper-soft text-copper",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "border-line bg-panel text-muted",
  normal: "border-line bg-canvas text-muted",
  high: "border-copper/20 bg-copper-soft text-copper",
  urgent: "border-red-200 bg-red-50 text-red-700",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${BASE} ${STATUS_CLASS[status]}`}>{TASK_STATUS_LABELS[status]}</span>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`${BASE} ${PRIORITY_CLASS[priority]}`}>{TASK_PRIORITY_LABELS[priority]}</span>
  );
}
