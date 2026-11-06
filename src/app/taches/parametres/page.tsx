import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TaskSettingsForm } from "@/components/task-settings-form";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listMentionableMembers } from "@/modules/discussion/queries";
import { TASK_PRIORITY_LABELS } from "@/modules/tasks/constants";
import { getTaskSettingsView } from "@/modules/tasks/settings";

export const metadata: Metadata = {
  title: "Paramètres des tâches",
};

export default function TaskSettingsPage(props: PageProps<"/taches/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <TaskSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TaskSettingsContent({
  searchParams,
}: Pick<PageProps<"/taches/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("tasks", "read");
  const db = getDb();
  const [settings, memberships, members, query] = await Promise.all([
    getTaskSettingsView(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    listMentionableMembers(db, session.tenantId),
    searchParams,
  ]);
  const canManage = await canAccessModule(session, "tasks", "manage");
  const defaultPriority = settings?.defaultPriority ?? "normal";
  const defaultDueInDays = settings?.defaultDueInDays ?? 0;
  const defaultAssignee = members.find(
    (member) => member.userId === settings?.defaultAssigneeUserId,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tasks" />
      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/taches"
            aria-label="Revenir aux tâches"
            title="Revenir aux tâches"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Tâches</p>
            <h1 className="text-2xl font-medium tracking-tight">Paramètres des tâches</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Ces valeurs sont proposées lors de la création d&apos;une tâche et peuvent être modifiées
          dans le formulaire. Zéro jour laisse l&apos;échéance vide ; l&apos;assigné par défaut doit
          être membre de cet espace.
        </p>

        {typeof query.enregistre === "string" ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Paramétrage enregistré.
          </p>
        ) : null}

        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Priorité</dt>
            <dd className="mt-1 text-sm">{TASK_PRIORITY_LABELS[defaultPriority]}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Délai d&apos;échéance</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {defaultDueInDays === 0 ? "Aucune" : `${defaultDueInDays} jours`}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Assigné</dt>
            <dd className="mt-1 text-sm">{defaultAssignee?.name ?? "Aucun"}</dd>
          </div>
        </dl>

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {settings === null ? "Définir le paramétrage" : "Modifier le paramétrage"}
              </h2>
            </div>
            <TaskSettingsForm
              values={{
                defaultPriority,
                defaultDueInDays,
                defaultAssigneeUserId: defaultAssignee?.userId ?? null,
              }}
              members={members}
            />
          </section>
        ) : (
          <p className="mt-5 text-[11px] text-muted">
            Seul un rôle disposant du niveau gestion peut modifier ce paramétrage.
          </p>
        )}
      </main>
    </div>
  );
}
