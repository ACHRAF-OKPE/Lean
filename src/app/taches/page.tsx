import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Filter, ListTodo, X } from "lucide-react";
import type { TaskPriority } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { TaskChrono } from "@/components/task-chrono";
import { TaskPriorityBadge, TaskStatusBadge } from "@/components/task-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMentionableMembers } from "@/modules/discussion/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  isTaskOverdue,
  isTaskPriority,
  isTaskStatus,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RELATED_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  relatedHref,
} from "@/modules/tasks/constants";
import { listTasks, taskCounters, type TaskFilters } from "@/modules/tasks/queries";
import { elapsedSecondsAt } from "@/modules/tasks/time";

export const metadata: Metadata = {
  title: "Tâches",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function parseFilters(query: SearchParams): TaskFilters {
  const statusValue = first(query.statut);
  const priorityValue = first(query.priorite);
  const assigneeValue = first(query.assigne);

  let status: TaskFilters["status"] = "active";
  if (statusValue === "all") {
    status = "all";
  } else if (isTaskStatus(statusValue)) {
    status = statusValue;
  }

  let assignee: TaskFilters["assignee"];
  if (assigneeValue === "me" || assigneeValue === "unassigned") {
    assignee = assigneeValue;
  } else if (/^[0-9a-f-]{36}$/i.test(assigneeValue)) {
    assignee = assigneeValue;
  }

  return {
    status,
    priority: isTaskPriority(priorityValue) ? (priorityValue as TaskPriority) : undefined,
    assignee,
    overdue: first(query.echeance) === "retard",
  };
}

export default function TasksPage(props: PageProps<"/taches">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des tâches…" />}>
      <TasksContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TasksContent({ searchParams }: Pick<PageProps<"/taches">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [query, memberships, members] = await Promise.all([
    searchParams,
    listMembershipsForUser(db, session.userId),
    listMentionableMembers(db, session.tenantId),
  ]);

  const filters = parseFilters(query);
  const [tasks, counters] = await Promise.all([
    listTasks(db, { tenantId: session.tenantId, userId: session.userId, filters }),
    taskCounters(db, { tenantId: session.tenantId, userId: session.userId }),
  ]);
  const now = new Date();
  const today = todayIsoDate(now);
  const filtered =
    filters.status !== "active" ||
    Boolean(filters.priority) ||
    Boolean(filters.assignee) ||
    Boolean(filters.overdue);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tasks" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Tâches</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Suivi des tâches</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Chaque tâche porte un statut, une priorité, une échéance et un assigné de
              l&apos;espace. Le chronomètre démarre au lancement ; la fiche rappelle le temps
              restant avant l&apos;échéance. Le fil de discussion et les documents liés sont sur la
              fiche.
            </p>
          </div>
          <CatalogActions kind="tasks" />
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Tâches ouvertes</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.active}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">En retard</dt>
            <dd
              className={`mt-1 font-mono text-2xl tabular-nums ${counters.overdue > 0 ? "text-copper" : ""}`}
            >
              {counters.overdue}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Mes tâches</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.mine}</dd>
          </div>
        </dl>

        <form method="get" action="/taches" className="mt-5 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] text-muted">
            Statut
            <select name="statut" defaultValue={filters.status ?? "active"} className={CONTROL}>
              <option value="active">Ouvertes et en cours</option>
              <option value="all">Tous les statuts</option>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-muted">
            Priorité
            <select name="priorite" defaultValue={filters.priority ?? ""} className={CONTROL}>
              <option value="">Toutes</option>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-muted">
            Assigné
            <select name="assigne" defaultValue={filters.assignee ?? ""} className={CONTROL}>
              <option value="">Tous</option>
              <option value="me">Mes tâches</option>
              <option value="unassigned">Non assignées</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 pb-1.5 text-[11px]">
            <input
              type="checkbox"
              name="echeance"
              value="retard"
              defaultChecked={filters.overdue}
              className="size-3.5 accent-brand"
            />
            En retard
          </label>

          <button
            type="submit"
            aria-label="Appliquer les filtres"
            title="Appliquer les filtres"
            className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <Filter className="size-3.5" aria-hidden="true" />
          </button>
          {filtered ? (
            <Link
              href="/taches"
              aria-label="Réinitialiser les filtres"
              title="Réinitialiser les filtres"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </form>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {tasks.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <ListTodo className="mx-auto size-6 text-muted" aria-hidden="true" />
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Aucune tâche ne correspond à ces filtres. Créez une tâche ou importez votre fichier
                XLSX avec le modèle téléchargeable.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Tâches de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Tâche
                    </th>
                    <th scope="col" className={TH}>
                      Priorité
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Chrono
                    </th>
                    <th scope="col" className={TH}>
                      Assigné
                    </th>
                    <th scope="col" className={TH}>
                      Échéance
                    </th>
                    <th scope="col" className={TH}>
                      Document
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const overdue = isTaskOverdue(task, today);
                    return (
                      <tr key={task.id} className="border-b border-line last:border-b-0">
                        <td className="max-w-80 px-4 py-2.5">
                          <Link
                            href={`/taches/${task.id}`}
                            className="block truncate font-medium hover:text-brand"
                          >
                            {task.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <TaskPriorityBadge priority={task.priority} />
                        </td>
                        <td className="px-4 py-2.5">
                          <TaskStatusBadge status={task.status} />
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <TaskChrono
                            compact
                            status={task.status}
                            startedAt={task.startedAt ? task.startedAt.toISOString() : null}
                            elapsedSeconds={task.elapsedSeconds}
                            initialSeconds={elapsedSecondsAt(task, now)}
                          />
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                          {task.assigneeName ?? "—"}
                        </td>
                        <td
                          className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${overdue ? "text-copper" : "text-muted"}`}
                        >
                          {task.dueDate ? isoDateLabel(task.dueDate) : "—"}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {task.relatedEntityType && task.relatedEntityId && task.relatedLabel ? (
                            <Link
                              href={relatedHref(task.relatedEntityType, task.relatedEntityId)}
                              className="inline-flex items-center gap-1 text-muted hover:text-brand"
                            >
                              {TASK_RELATED_LABELS[task.relatedEntityType]}
                              <span className="font-mono text-[10px]">{task.relatedLabel}</span>
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/taches/${task.id}`}
                            aria-label={`Ouvrir la tâche ${task.title}`}
                            title="Ouvrir la tâche"
                            className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {tasks.length === 100 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 100 tâches les plus urgentes selon l&apos;échéance. Précisez les filtres
            pour affiner.
          </p>
        ) : null}
      </main>
    </div>
  );
}
