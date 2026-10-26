import { MessagesSquare } from "lucide-react";
import type { DiscussionEntityType } from "@/db/schema";
import { getDb } from "@/db/client";
import { can } from "@/modules/identity/permissions";
import type { SessionContext } from "@/modules/identity/queries";
import { listDiscussionMessages, listMentionableMembers } from "@/modules/discussion/queries";
import { DiscussionForm } from "./discussion-form";

const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

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
      className="mt-6 overflow-hidden rounded-xl border border-line bg-panel"
    >
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <MessagesSquare className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Discussion interne</h2>
        <span className="font-mono text-[10px] text-muted">{messages.length}</span>
      </div>

      {messages.length === 0 ? (
        <p className="px-5 py-6 text-center text-[11px] text-muted">
          Aucun message. Le fil est interne à l&apos;équipe : il n&apos;est jamais envoyé au tiers.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`px-5 py-3 ${message.kind === "event" ? "bg-canvas/40" : ""}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">
                  {message.authorName ?? "Utilisateur supprimé"}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {DATE_TIME.format(message.createdAt)}
                </span>
                {message.kind === "event" ? (
                  <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[9px] tracking-wide text-muted uppercase">
                    Événement
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-5 whitespace-pre-line">{message.body}</p>
              {message.mentions.length > 0 ? (
                <p className="mt-1 text-[10px] text-muted">
                  Mentionne : {message.mentions.map((mention) => mention.name).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <DiscussionForm entityType={entityType} entityId={entityId} members={members} />
      ) : (
        <p className="border-t border-line px-5 py-4 text-[10px] text-muted">
          La publication d&apos;un commentaire exige le droit d&apos;écriture.
        </p>
      )}
    </section>
  );
}
