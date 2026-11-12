import { Activity, MessagesSquare } from "lucide-react";
import type { DiscussionEntityType } from "@/db/schema";
import { getDb } from "@/db/client";
import { can } from "@/modules/identity/permissions";
import type { SessionContext } from "@/modules/identity/queries";
import { listDiscussionMessages, listMentionableMembers } from "@/modules/discussion/queries";
import { DiscussionInteractive } from "./discussion-interactive";

export async function DiscussionPanel({
  session,
  entityType,
  entityId,
}: {
  session: SessionContext;
  entityType: DiscussionEntityType;
  entityId: string;
}) {
  const db = getDb();
  const [messages, members] = await Promise.all([
    listDiscussionMessages(db, { tenantId: session.tenantId, entityType, entityId }),
    listMentionableMembers(db, session.tenantId),
  ]);
  const canWrite = can(session.role, "data.write");

  return (
    <section
      id="discussion"
      className="mt-6 overflow-hidden rounded-xl border border-line bg-panel shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-lg border border-brand/20 bg-brand-soft text-brand-strong">
            <MessagesSquare className="size-3.5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Activité &amp; Échanges</h2>
            <p className="text-[10px] text-muted">
              Fil interne confidentiel · Décisions, questions et jalons système
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2.5 py-0.5 text-[10px] text-muted">
            <Activity className="size-3 text-brand" aria-hidden="true" />
            <span className="font-mono tabular-nums">{messages.length}</span> entrée
            {messages.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <DiscussionInteractive
        entityType={entityType}
        entityId={entityId}
        messages={messages}
        members={members}
        canWrite={canWrite}
      />
    </section>
  );
}
