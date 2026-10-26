"use client";

import { useActionState, useRef } from "react";
import { Send } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { postCommentAction } from "@/lib/discussion/actions";
import { initialDiscussionFormState, type DiscussionFormState } from "@/lib/discussion/form-state";
import type { MentionableMember } from "@/modules/discussion/queries";
import { COMMENT_MAX_LENGTH } from "@/modules/discussion/constants";
import type { DiscussionEntityType } from "@/db/schema";

const ROLE_LABELS: Record<MentionableMember["role"], string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
};

export function DiscussionForm({
  entityType,
  entityId,
  members,
}: {
  entityType: DiscussionEntityType;
  entityId: string;
  members: readonly MentionableMember[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: DiscussionFormState, formData: FormData) => {
      const result = await postCommentAction(previous, formData);
      if (result.ok) {
        formRef.current?.reset();
      }
      return result;
    },
    initialDiscussionFormState,
  );

  const mentionable = members.filter((member) => member.userId);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 border-t border-line px-5 py-4">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />

      <div className="space-y-1.5">
        <label htmlFor={`discussion-body-${entityId}`} className="block text-[11px] font-medium">
          Commentaire
        </label>
        <textarea
          id={`discussion-body-${entityId}`}
          name="body"
          rows={3}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Note interne, question, décision…"
          className={`${INPUT_CLASS} min-h-20 resize-y`}
        />
        <p className="text-[10px] text-muted">
          Texte brut, {COMMENT_MAX_LENGTH.toLocaleString("fr-FR")} caractères au plus. Un
          commentaire n&apos;est jamais modifiable ni supprimable.
        </p>
      </div>

      {mentionable.length > 1 ? (
        <details className="rounded-md border border-line bg-canvas/40 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted">
            Mentionner des membres
          </summary>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {mentionable.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11px]"
              >
                <input
                  type="checkbox"
                  name="mentionedUserIds"
                  value={member.userId}
                  className="size-3.5 accent-brand"
                />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                <span className="text-[9px] text-muted uppercase">{ROLE_LABELS[member.role]}</span>
              </label>
            ))}
          </div>
        </details>
      ) : null}

      <FormErrors errors={state.errors} />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          aria-label="Publier le commentaire"
          title="Publier le commentaire"
          className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40 disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
