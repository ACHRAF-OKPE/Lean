"use client";

import { useState } from "react";
import type { DiscussionEntityType } from "@/db/schema";
import type { DiscussionMessageSummary, MentionableMember } from "@/modules/discussion/queries";
import { DiscussionFeed } from "./discussion-feed";
import { DiscussionForm } from "./discussion-form";

export function DiscussionInteractive({
  entityType,
  entityId,
  messages,
  members,
  canWrite,
}: {
  readonly entityType: DiscussionEntityType;
  readonly entityId: string;
  readonly messages: readonly DiscussionMessageSummary[];
  readonly members: readonly MentionableMember[];
  readonly canWrite: boolean;
}) {
  const [quickReplyText, setQuickReplyText] = useState<string>("");

  const handleQuickReply = (text: string) => {
    setQuickReplyText(text);
  };

  return (
    <>
      <DiscussionFeed messages={messages} onQuickReply={canWrite ? handleQuickReply : undefined} />

      {canWrite ? (
        <DiscussionForm
          key={quickReplyText}
          entityType={entityType}
          entityId={entityId}
          members={members}
          initialText={quickReplyText}
        />
      ) : (
        <p className="border-t border-line px-5 py-4 text-[10px] text-muted">
          La publication d&apos;un commentaire ou d&apos;une note exige le droit d&apos;écriture.
        </p>
      )}
    </>
  );
}
