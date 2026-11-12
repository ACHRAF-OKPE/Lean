export type MessageTag = "note" | "question" | "decision" | "urgent";

export interface MessageTagMeta {
  readonly id: MessageTag;
  readonly label: string;
  readonly prefix: string;
  readonly description: string;
  readonly badgeClass: string;
  readonly chipClass: string;
}

export const MESSAGE_TAGS: readonly MessageTag[] = [
  "note",
  "question",
  "decision",
  "urgent",
] as const;

export const MESSAGE_TAG_METAS: Record<MessageTag, MessageTagMeta> = {
  note: {
    id: "note",
    label: "Note",
    prefix: "[NOTE]",
    description: "Note interne",
    badgeClass: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    chipClass: "border-slate-500/30 text-slate-700 dark:text-slate-300",
  },
  question: {
    id: "question",
    label: "Question",
    prefix: "[QUESTION]",
    description: "Question à l'équipe",
    badgeClass: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    chipClass: "border-sky-500/30 text-sky-700 dark:text-sky-300",
  },
  decision: {
    id: "decision",
    label: "Décision",
    prefix: "[DÉCISION]",
    description: "Arbitrage ou décision actée",
    badgeClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    chipClass: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  },
  urgent: {
    id: "urgent",
    label: "Urgent",
    prefix: "[URGENT]",
    description: "Attention prioritaire requise",
    badgeClass: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    chipClass: "border-rose-500/30 text-rose-700 dark:text-rose-300",
  },
};

const TAG_REGEX = /^\[(NOTE|QUESTION|DÉCISION|DECISION|URGENT)\]\s*/i;

export function isMessageTag(value: unknown): value is MessageTag {
  return typeof value === "string" && (MESSAGE_TAGS as readonly string[]).includes(value);
}

export interface ParsedMessageContent {
  readonly tag: MessageTag | null;
  readonly cleanBody: string;
  readonly rawBody: string;
}

export function parseMessageTag(body: string): ParsedMessageContent {
  const rawBody = body;
  const match = body.match(TAG_REGEX);
  if (!match) {
    return { tag: null, cleanBody: body, rawBody };
  }

  const raw = match[1]?.toUpperCase();
  let tag: MessageTag | null = null;
  if (raw === "NOTE") tag = "note";
  else if (raw === "QUESTION") tag = "question";
  else if (raw === "DÉCISION" || raw === "DECISION") tag = "decision";
  else if (raw === "URGENT") tag = "urgent";

  const cleanBody = body.slice(match[0].length);
  return { tag, cleanBody, rawBody };
}

export function formatTaggedBody(body: string, tag: MessageTag | null | undefined): string {
  const trimmed = body.trim();
  if (!tag) {
    return trimmed;
  }
  const parsed = parseMessageTag(trimmed);
  if (parsed.tag) {
    // Already has a tag prefix
    return trimmed;
  }
  const meta = MESSAGE_TAG_METAS[tag];
  return `${meta.prefix} ${trimmed}`;
}
