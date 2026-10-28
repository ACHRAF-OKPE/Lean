import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Lock, Paperclip } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DiscussionPanel } from "@/components/discussion-panel";
import { LoadingShell } from "@/components/loading-shell";
import { TaskAssigneeForm, TaskStatusActions } from "@/components/task-controls";
import { TaskPriorityBadge, TaskStatusBadge } from "@/components/task-badges";
import { TaskForm } from "@/components/task-form";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMentionableMembers } from "@/modules/discussion/queries";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  isTaskClosed,
  isTaskOverdue,
  TASK_RELATED_LABELS,
  relatedHref,
} from "@/modules/tasks/constants";
import { getTask } from "@/modules/tasks/queries";

export const metadata: Metadata = {
  title: "Tâche",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "Africa/Abidjan",
});

const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function TaskPage(props: PageProps<"/taches/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la tâche…" />}>
      <TaskContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TaskContent({
  params,
  searchParams,
}: Pick<PageProps<"/taches/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [task, memberships, members, query] = await Promise.all([
    getTask(db, { tenantId: session.tenantId, taskId: id }),
    listMembershipsForUser(db, session.userId),
    listMentionableMembers(db, session.tenantId),
    searchParams,
  ]);
  if (!task) {
    notFound();
  }

  const canWrite = can(session.role, "data.write");
  const closed = isTaskClosed(task.status);
  const overdue = isTaskOverdue(task, todayIsoDate());
  const created = query.cree === "1";
  const updated = query.maj === "1";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tasks" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/taches"
            aria-label="Revenir aux tâches"
            title="Revenir aux tâches"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Tâche</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">{task.title}</h1>
          </div>
          {canWrite ? <TaskStatusActions taskId={task.id} status={task.status} /> : null}
        </div>

        {created || updated ? (
          <p className="mt-4 rounded-lg border border-brand/20 bg-brand-soft px-4 py-2.5 text-[11px] text-brand-strong">
            {created ? "Tâche créée." : "Tâche mise à jour."}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <TaskPriorityBadge priority={task.priority} />
          {overdue ? (
            <span className="rounded-full border border-copper/20 bg-copper-soft px-2 py-0.5 text-[10px] text-copper">
              En retard
            </span>
          ) : null}
          {closed ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <Lock className="size-3" aria-hidden="true" />
              Tâche figée : rouvrez-la pour la modifier.
            </span>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Échéance</dt>
            <dd className={`mt-1 text-[12px] tabular-nums ${overdue ? "text-copper" : ""}`}>
              {task.dueDate ? isoDateLabel(task.dueDate) : "Aucune"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Assigné</dt>
            <dd className="mt-1 text-[12px]">{task.assigneeName ?? "Personne"}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Créée par</dt>
            <dd className="mt-1 text-[12px]">
              {task.createdByName ?? "Utilisateur supprimé"}
              <span className="block text-[10px] text-muted">
                le {DATE_TIME.format(task.createdAt)}
              </span>
            </dd>
          </div>
        </dl>

        {task.completedAt ? (
          <p className="mt-2 text-[10px] text-muted">
            Terminée par {task.completedByName ?? "un utilisateur supprimé"} le{" "}
            {DATE.format(task.completedAt)}.
          </p>
        ) : null}

        {task.relatedEntityType && task.relatedEntityId ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <div className="flex items-center gap-2">
              <Paperclip className="size-3.5 text-brand" aria-hidden="true" />
              <div>
                <p className="text-[10px] text-muted">
                  {TASK_RELATED_LABELS[task.relatedEntityType]}
                </p>
                <p className="text-[12px] font-medium">{task.relatedLabel ?? "Document lié"}</p>
              </div>
            </div>
            <Link
              href={relatedHref(task.relatedEntityType, task.relatedEntityId)}
              aria-label="Ouvrir le document lié"
              title="Ouvrir le document lié"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        ) : null}

        {task.description ? (
          <section className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-[11px] font-semibold">Description</h2>
            <p className="mt-2 text-[12px] leading-6 whitespace-pre-line">{task.description}</p>
          </section>
        ) : null}

        {canWrite && !closed ? (
          <section className="mt-4 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Assignation</h2>
            <div className="mt-3">
              <TaskAssigneeForm
                taskId={task.id}
                assigneeUserId={task.assigneeUserId}
                members={members}
              />
            </div>
          </section>
        ) : null}

        {canWrite ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold">Modifier la tâche</summary>
            {closed ? (
              <p className="mt-3 text-[11px] text-muted">
                Cette tâche est terminée ou annulée : rouvrez-la avant de modifier son contenu.
              </p>
            ) : (
              <div className="mt-4">
                <TaskForm
                  mode="edit"
                  taskId={task.id}
                  members={members}
                  task={{
                    title: task.title,
                    description: task.description,
                    priority: task.priority,
                    dueDate: task.dueDate,
                    assigneeUserId: task.assigneeUserId,
                  }}
                />
              </div>
            )}
          </details>
        ) : null}

        <DiscussionPanel session={session} entityType="task" entityId={task.id} />
      </main>
    </div>
  );
}
