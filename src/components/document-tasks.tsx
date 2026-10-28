import Link from "next/link";
import { ArrowUpRight, ListTodo, Plus } from "lucide-react";
import type { TaskRelatedEntityType } from "@/db/schema";
import { getDb } from "@/db/client";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import type { SessionContext } from "@/modules/identity/queries";
import { isTaskOverdue, TASK_RELATED_LABELS } from "@/modules/tasks/constants";
import { listTasksForEntity } from "@/modules/tasks/queries";
import { TaskPriorityBadge, TaskStatusBadge } from "./task-badges";

export async function DocumentTasks({
  session,
  entityType,
  entityId,
  label,
}: {
  session: SessionContext;
  entityType: TaskRelatedEntityType;
  entityId: string;
  label: string;
}) {
  const tasks = await listTasksForEntity(getDb(), {
    tenantId: session.tenantId,
    entityType,
    entityId,
  });
  const today = todayIsoDate();
  const newHref = `/taches/nouvelle?document_type=${entityType}&document_id=${entityId}&document_label=${encodeURIComponent(label)}`;

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <ListTodo className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Tâches</h2>
        <span className="font-mono text-[10px] text-muted">{tasks.length}</span>
        <Link
          href={newHref}
          aria-label={`Créer une tâche sur ${TASK_RELATED_LABELS[entityType].toLowerCase()}`}
          title="Créer une tâche liée"
          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-center text-[11px] text-muted">
          Aucune tâche ouverte sur ce document.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <Link
                href={`/taches/${task.id}`}
                className="min-w-0 flex-1 truncate text-[11px] font-medium hover:text-brand"
              >
                {task.title}
              </Link>
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority} />
              <span
                className={`w-20 text-right font-mono text-[10px] tabular-nums ${
                  isTaskOverdue(task, today) ? "text-copper" : "text-muted"
                }`}
              >
                {task.dueDate ? isoDateLabel(task.dueDate) : "—"}
              </span>
              <span className="w-28 truncate text-right text-[10px] text-muted">
                {task.assigneeName ?? "Non assignée"}
              </span>
              <Link
                href={`/taches/${task.id}`}
                aria-label={`Ouvrir la tâche ${task.title}`}
                title="Ouvrir la tâche"
                className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
