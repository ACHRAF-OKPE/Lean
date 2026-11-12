"use client";

import { useActionState, useCallback, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertCircle,
  AtSign,
  Bookmark,
  CheckCircle2,
  HelpCircle,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { postCommentAction } from "@/lib/discussion/actions";
import { initialDiscussionFormState, type DiscussionFormState } from "@/lib/discussion/form-state";
import type { MentionableMember } from "@/modules/discussion/queries";
import { COMMENT_MAX_LENGTH } from "@/modules/discussion/constants";
import type { DiscussionEntityType } from "@/db/schema";
import { MESSAGE_TAG_METAS, type MessageTag } from "@/modules/discussion/tags";
import { getInitials } from "@/modules/discussion/mentions";

const ROLE_LABELS: Record<MentionableMember["role"], string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
};

export function DiscussionForm({
  entityType,
  entityId,
  members,
  initialText = "",
}: {
  readonly entityType: DiscussionEntityType;
  readonly entityId: string;
  readonly members: readonly MentionableMember[];
  readonly initialText?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [bodyText, setBodyText] = useState(initialText);
  const [selectedTag, setSelectedTag] = useState<MessageTag | null>(null);
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);

  // État de l'autocomplétion @
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);

  const mentionable = members.filter((member) => member.userId);

  // Filtrage des membres pour le menu d'autocomplétion
  const matchingMembers =
    mentionQuery === null
      ? []
      : mentionable.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const [state, formAction, pending] = useActionState(
    async (previous: DiscussionFormState, formData: FormData) => {
      const result = await postCommentAction(previous, formData);
      if (result.ok) {
        setBodyText("");
        setSelectedTag(null);
        setTaggedUserIds([]);
        setMentionQuery(null);
        formRef.current?.reset();
      }
      return result;
    },
    initialDiscussionFormState,
  );

  // Détecter la saisie du `@` dans la zone de texte
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBodyText(value);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const query = textBeforeCursor.slice(lastAtIndex + 1);
      // On affiche le menu si la requête ne contient pas d'espace ou retour chariot
      if (!/[\s\n]/.test(query) && query.length < 30) {
        setMentionQuery(query);
        setMentionIndex(lastAtIndex);
        setMenuIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  };

  // Insertion d'un membre sélectionné via autocomplétion ou puce
  const insertMention = useCallback(
    (member: MentionableMember) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      let newText = bodyText;
      const mentionText = `@${member.name} `;

      if (mentionQuery !== null && mentionIndex !== -1) {
        const before = bodyText.slice(0, mentionIndex);
        const after = bodyText.slice(textarea.selectionStart);
        newText = `${before}${mentionText}${after}`;
      } else {
        newText = bodyText ? `${bodyText.trimEnd()} ${mentionText}` : mentionText;
      }

      setBodyText(newText);
      setMentionQuery(null);

      // Ajouter aux membres tagués
      setTaggedUserIds((prev) => (prev.includes(member.userId) ? prev : [...prev, member.userId]));

      // Replacer le focus
      setTimeout(() => {
        textarea.focus();
      }, 0);
    },
    [bodyText, mentionIndex, mentionQuery],
  );

  const removeTaggedUser = (userId: string) => {
    setTaggedUserIds((prev) => prev.filter((id) => id !== userId));
  };

  // Gestion des raccourcis clavier dans le textarea
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Raccourci Ctrl+Enter ou Cmd+Enter pour publier
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!pending && bodyText.trim()) {
        formRef.current?.requestSubmit();
      }
      return;
    }

    // Gestion du menu d'autocomplétion
    if (mentionQuery !== null && matchingMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((prev) => (prev + 1) % matchingMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((prev) => (prev - 1 + matchingMembers.length) % matchingMembers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = matchingMembers[menuIndex];
        if (selected) {
          insertMention(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
  };

  const remainingChars = COMMENT_MAX_LENGTH - bodyText.length;
  const isNearLimit = remainingChars < 300;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative space-y-3 border-t border-line px-5 py-4"
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      {selectedTag ? <input type="hidden" name="tag" value={selectedTag} /> : null}
      {taggedUserIds.map((id) => (
        <input key={id} type="hidden" name="mentionedUserIds" value={id} />
      ))}

      {/* Barre de sélection du tag / statut de message */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="mr-1 text-[10px] font-medium text-muted">Classification :</span>
        <button
          type="button"
          onClick={() => setSelectedTag((prev) => (prev === "note" ? null : "note"))}
          aria-label={selectedTag === "note" ? "Désélectionner Note" : "Sélectionner le tag Note"}
          title="Note interne d'information"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
            selectedTag === "note"
              ? "border-slate-500/40 bg-slate-500/20 font-semibold text-slate-800 shadow-xs dark:text-slate-200"
              : "border-line bg-panel text-muted hover:border-slate-500/30"
          }`}
        >
          <Bookmark className="size-3" aria-hidden="true" />
          {MESSAGE_TAG_METAS.note.label}
        </button>

        <button
          type="button"
          onClick={() => setSelectedTag((prev) => (prev === "question" ? null : "question"))}
          aria-label={
            selectedTag === "question" ? "Désélectionner Question" : "Sélectionner le tag Question"
          }
          title="Question ou demande d'éclaircissement"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
            selectedTag === "question"
              ? "border-sky-500/40 bg-sky-500/20 font-semibold text-sky-800 shadow-xs dark:text-sky-200"
              : "border-line bg-panel text-muted hover:border-sky-500/30"
          }`}
        >
          <HelpCircle className="size-3" aria-hidden="true" />
          {MESSAGE_TAG_METAS.question.label}
        </button>

        <button
          type="button"
          onClick={() => setSelectedTag((prev) => (prev === "decision" ? null : "decision"))}
          aria-label={
            selectedTag === "decision" ? "Désélectionner Décision" : "Sélectionner le tag Décision"
          }
          title="Décision ou validation formelle"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
            selectedTag === "decision"
              ? "border-emerald-500/40 bg-emerald-500/20 font-semibold text-emerald-800 shadow-xs dark:text-emerald-200"
              : "border-line bg-panel text-muted hover:border-emerald-500/30"
          }`}
        >
          <CheckCircle2 className="size-3" aria-hidden="true" />
          {MESSAGE_TAG_METAS.decision.label}
        </button>

        <button
          type="button"
          onClick={() => setSelectedTag((prev) => (prev === "urgent" ? null : "urgent"))}
          aria-label={
            selectedTag === "urgent" ? "Désélectionner Urgent" : "Sélectionner le tag Urgent"
          }
          title="Attention immédiate requise"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
            selectedTag === "urgent"
              ? "border-rose-500/40 bg-rose-500/20 font-semibold text-rose-800 shadow-xs dark:text-rose-200"
              : "border-line bg-panel text-muted hover:border-rose-500/30"
          }`}
        >
          <AlertCircle className="size-3" aria-hidden="true" />
          {MESSAGE_TAG_METAS.urgent.label}
        </button>
      </div>

      {/* Zone de saisie principale */}
      <div className="relative space-y-1.5">
        <label htmlFor={`discussion-body-${entityId}`} className="block text-[11px] font-medium">
          Nouveau message
        </label>
        <textarea
          ref={textareaRef}
          id={`discussion-body-${entityId}`}
          name="body"
          value={bodyText}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Rédigez une note, formulez une question, tapez @ pour taguer un collègue…"
          className={`${INPUT_CLASS} min-h-22 resize-y font-sans`}
        />

        {/* Menu flottant d'autocomplétion @mention */}
        {mentionQuery !== null && matchingMembers.length > 0 ? (
          <div className="absolute top-16 left-2 z-50 max-h-48 w-64 overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-lg">
            <p className="px-2 py-1 font-mono text-[9px] tracking-wider text-muted uppercase">
              Taguer une personne
            </p>
            <ul className="space-y-0.5">
              {matchingMembers.map((member, idx) => (
                <li key={member.userId}>
                  <button
                    type="button"
                    onClick={() => insertMention(member)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                      idx === menuIndex
                        ? "bg-brand-soft font-medium text-brand-strong"
                        : "text-foreground hover:bg-canvas"
                    }`}
                  >
                    <span className="grid size-5 place-items-center rounded-full bg-brand-soft text-[8px] font-bold text-brand">
                      {getInitials(member.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    <span className="text-[9px] text-muted uppercase">
                      {ROLE_LABELS[member.role]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Barre d'info sous le textarea */}
        <div className="flex flex-wrap items-center justify-between text-[10px] text-muted">
          <span>
            Tapez{" "}
            <kbd className="rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[9px]">
              @
            </kbd>{" "}
            pour taguer ·{" "}
            <kbd className="rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[9px]">
              Ctrl
            </kbd>
            +
            <kbd className="rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[9px]">
              Entrée
            </kbd>{" "}
            pour publier
          </span>
          <span className={`font-mono ${isNearLimit ? "font-semibold text-copper" : ""}`}>
            {remainingChars.toLocaleString("fr-FR")} car. restants
          </span>
        </div>
      </div>

      {/* Puces de tag rapide de collègues */}
      {mentionable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="flex items-center gap-1 text-[10px] font-medium text-muted">
            <AtSign className="size-3" aria-hidden="true" />
            Taguer un collègue :
          </span>
          {mentionable.slice(0, 6).map((member) => {
            const isTagged = taggedUserIds.includes(member.userId);
            return (
              <button
                key={member.userId}
                type="button"
                onClick={() => (isTagged ? removeTaggedUser(member.userId) : insertMention(member))}
                aria-label={isTagged ? `Retirer le tag de ${member.name}` : `Taguer ${member.name}`}
                title={isTagged ? `Retirer ${member.name}` : `Taguer ${member.name}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  isTagged
                    ? "border-brand/40 bg-brand-soft font-medium text-brand-strong"
                    : "hover:text-foreground border-line bg-canvas text-muted hover:border-brand/30"
                }`}
              >
                <span className="grid size-3.5 place-items-center rounded-full bg-brand-soft text-[7px] font-bold text-brand">
                  {getInitials(member.name)}
                </span>
                <span>{member.name}</span>
                {isTagged ? <X className="size-2.5 text-brand" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Personnes actuellement taguées avec pastilles amovibles */}
      {taggedUserIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand/15 bg-brand-soft/30 p-2 text-[10px]">
          <span className="flex items-center gap-1 font-medium text-brand-strong">
            <Users className="size-3" aria-hidden="true" />
            Destinataires notifiés ({taggedUserIds.length}) :
          </span>
          {taggedUserIds.map((id) => {
            const member = mentionable.find((m) => m.userId === id);
            if (!member) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-panel px-2 py-0.5 text-brand-strong"
              >
                {member.name}
                <button
                  type="button"
                  onClick={() => removeTaggedUser(id)}
                  aria-label={`Retirer la mention de ${member.name}`}
                  title={`Retirer ${member.name}`}
                  className="grid size-3 place-items-center rounded-full hover:bg-brand/20"
                >
                  <X className="size-2" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <FormErrors errors={state.errors} />

      {/* Bouton d'action iconique soumettre (conforme GEN-009) */}
      <div className="flex items-center justify-between border-t border-line/60 pt-2">
        <p className="text-[9px] text-muted">
          Les messages internes et mentions ne sont jamais diffusés à l&apos;extérieur du tenant.
        </p>

        <button
          type="submit"
          disabled={pending || !bodyText.trim()}
          aria-label="Publier le commentaire"
          title="Publier le commentaire (Ctrl+Entrée)"
          className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40 disabled:opacity-40"
        >
          {pending ? (
            <Sparkles className="size-4 animate-spin text-brand" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
