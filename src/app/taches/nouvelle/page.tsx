import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TaskForm, type LinkedDocument } from "@/components/task-form";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMentionableMembers } from "@/modules/discussion/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { isTaskRelatedEntityType, TASK_RELATED_LABELS } from "@/modules/tasks/constants";

export const metadata: Metadata = {
  title: "Nouvelle tâche",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NewTaskPage(props: PageProps<"/taches/nouvelle">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewTaskContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function NewTaskContent({
  searchParams,
}: Pick<PageProps<"/taches/nouvelle">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.write");
  const query = await searchParams;
  const db = getDb();
  const [memberships, members] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    listMentionableMembers(db, session.tenantId),
  ]);

  const documentType = typeof query.document_type === "string" ? query.document_type : "";
  const documentId = typeof query.document_id === "string" ? query.document_id : "";
  const documentLabel = typeof query.document_label === "string" ? query.document_label : "";

  let linkedDocument: LinkedDocument | undefined;
  if (isTaskRelatedEntityType(documentType) && UUID_PATTERN.test(documentId)) {
    linkedDocument = {
      type: documentType,
      id: documentId,
      label: documentLabel || TASK_RELATED_LABELS[documentType],
    };
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tasks" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle tâche</h1>
          </div>
        </div>

        <p className="mt-3 max-w-xl text-[11px] leading-5 text-muted">
          Une tâche naît ouverte. Le titre est obligatoire ; la priorité vaut Normale par défaut et
          la description reste du texte brut, interne à l&apos;équipe.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <TaskForm mode="create" members={members} linkedDocument={linkedDocument} />
        </section>
      </main>
    </div>
  );
}
