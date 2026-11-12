"use client";

import { useId, useMemo, useState } from "react";
import {
  ArrowUpDown,
  AtSign,
  Check,
  CheckSquare,
  Clock,
  Copy,
  MailCheck,
  MessageSquare,
  PackageCheck,
  Receipt,
  Search,
  ShoppingCart,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";
import type { DiscussionMessageSummary } from "@/modules/discussion/queries";
import { parseMessageTag, type MessageTag } from "@/modules/discussion/tags";
import { getInitials, parseBodyWithMentions } from "@/modules/discussion/mentions";

const FULL_DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "medium",
  timeZone: "Africa/Abidjan",
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "À l'instant";
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
  if (diffHours < 24) return `Il y a ${diffHours} h`;
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} j`;
  return SHORT_DATE_FORMAT.format(date);
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
};

const TAG_BADGES: Record<MessageTag, { label: string; className: string }> = {
  note: {
    label: "Note",
    className: "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  question: {
    label: "Question",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  decision: {
    label: "Décision",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  urgent: {
    label: "Urgent",
    className: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

function getEventIcon(eventType: string | null) {
  if (!eventType) return MessageSquare;
  if (
    eventType.startsWith("purchase_order.received") ||
    eventType.startsWith("purchase_order.reception")
  ) {
    return PackageCheck;
  }
  if (eventType.startsWith("purchase_order.supplier_reply")) {
    return MailCheck;
  }
  if (eventType.startsWith("purchase_order")) {
    return ShoppingCart;
  }
  if (
    eventType.startsWith("sales_order.delivered") ||
    eventType.startsWith("sales_order.delivery")
  ) {
    return Truck;
  }
  if (eventType.startsWith("sales_order")) {
    return ShoppingBag;
  }
  if (eventType.startsWith("invoice")) {
    return Receipt;
  }
  if (eventType.startsWith("task")) {
    return CheckSquare;
  }
  return MessageSquare;
}

export function DiscussionFeed({
  messages,
  onQuickReply,
}: {
  readonly messages: readonly DiscussionMessageSummary[];
  readonly onQuickReply?: (templateText: string) => void;
}) {
  const [filterTab, setFilterTab] = useState<"all" | "comments" | "events" | "mentions">("all");
  const [tagFilter, setTagFilter] = useState<"all" | MessageTag>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAscending, setIsAscending] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const searchInputId = useId();

  // Statistiques de l'activité
  const stats = useMemo(() => {
    let commentCount = 0;
    let eventCount = 0;
    let mentionCount = 0;
    for (const msg of messages) {
      if (msg.kind === "comment") commentCount++;
      if (msg.kind === "event") eventCount++;
      if (msg.mentions.length > 0) mentionCount++;
    }
    return { total: messages.length, commentCount, eventCount, mentionCount };
  }, [messages]);

  // Filtrage des messages
  const filteredMessages = useMemo(() => {
    let list = [...messages];

    // Tri chronologique
    if (!isAscending) {
      list.reverse();
    }

    // Filtre d'onglet principal
    if (filterTab === "comments") {
      list = list.filter((m) => m.kind === "comment");
    } else if (filterTab === "events") {
      list = list.filter((m) => m.kind === "event");
    } else if (filterTab === "mentions") {
      list = list.filter((m) => m.mentions.length > 0);
    }

    // Filtre par tag
    if (tagFilter !== "all") {
      list = list.filter((m) => {
        const parsed = parseMessageTag(m.body);
        return parsed.tag === tagFilter;
      });
    }

    // Filtre par recherche textuelle
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((m) => {
        const matchBody = m.body.toLowerCase().includes(q);
        const matchAuthor = m.authorName?.toLowerCase().includes(q) ?? false;
        const matchMentions = m.mentions.some((men) => men.name.toLowerCase().includes(q));
        return matchBody || matchAuthor || matchMentions;
      });
    }

    return list;
  }, [messages, filterTab, tagFilter, searchQuery, isAscending]);

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 2000);
  };

  return (
    <div className="space-y-4">
      {/* Barre de contrôle et filtres */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-5 py-3">
        {/* Onglets principaux */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFilterTab("all")}
            aria-label="Afficher toute l'activité"
            title="Afficher toute l'activité"
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filterTab === "all"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-canvas"
            }`}
          >
            Tout ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("comments")}
            aria-label="Afficher uniquement les commentaires"
            title="Afficher uniquement les commentaires"
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filterTab === "comments"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-canvas"
            }`}
          >
            Échanges ({stats.commentCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("events")}
            aria-label="Afficher uniquement les événements système"
            title="Afficher uniquement les événements système"
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filterTab === "events"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-canvas"
            }`}
          >
            Événements ({stats.eventCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("mentions")}
            aria-label="Afficher uniquement les messages avec mentions"
            title="Afficher uniquement les messages avec mentions"
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filterTab === "mentions"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-canvas"
            }`}
          >
            Mentions ({stats.mentionCount})
          </button>
        </div>

        {/* Outils : Recherche et Inversion chronologique */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              aria-label="Rechercher dans la discussion"
              className="text-foreground h-7 w-32 rounded-md border border-line bg-canvas pr-2 pl-7 text-[10px] transition-all placeholder:text-muted focus:w-44 focus:border-brand/40 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setIsAscending((prev) => !prev)}
            aria-label={
              isAscending ? "Ordre : plus ancien en premier" : "Ordre : plus récent en premier"
            }
            title={
              isAscending
                ? "Ordre chronologique (du plus ancien au plus récent)"
                : "Ordre antichronologique (du plus récent au plus ancien)"
            }
            className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowUpDown className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Barre de sous-filtres par Tags de message */}
      {stats.commentCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-5 text-[10px] text-muted">
          <span className="font-medium text-muted">Filtrer par type :</span>
          <button
            type="button"
            onClick={() => setTagFilter("all")}
            aria-label="Tous les types de messages"
            title="Tous les types de messages"
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tagFilter === "all"
                ? "border-brand/30 bg-brand-soft font-medium text-brand-strong"
                : "border-line bg-panel text-muted hover:border-brand/20"
            }`}
          >
            Tous
          </button>
          <button
            type="button"
            onClick={() => setTagFilter("decision")}
            aria-label="Filtrer par Décisions"
            title="Filtrer par Décisions"
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tagFilter === "decision"
                ? "border-emerald-500/30 bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
                : "border-line bg-panel text-muted hover:border-emerald-500/30"
            }`}
          >
            Décisions
          </button>
          <button
            type="button"
            onClick={() => setTagFilter("question")}
            aria-label="Filtrer par Questions"
            title="Filtrer par Questions"
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tagFilter === "question"
                ? "border-sky-500/30 bg-sky-500/15 font-medium text-sky-700 dark:text-sky-300"
                : "border-line bg-panel text-muted hover:border-sky-500/30"
            }`}
          >
            Questions
          </button>
          <button
            type="button"
            onClick={() => setTagFilter("note")}
            aria-label="Filtrer par Notes"
            title="Filtrer par Notes"
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tagFilter === "note"
                ? "border-slate-500/30 bg-slate-500/15 font-medium text-slate-700 dark:text-slate-300"
                : "border-line bg-panel text-muted hover:border-slate-500/30"
            }`}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => setTagFilter("urgent")}
            aria-label="Filtrer par Urgences"
            title="Filtrer par Urgences"
            className={`rounded-full border px-2 py-0.5 transition-colors ${
              tagFilter === "urgent"
                ? "border-rose-500/30 bg-rose-500/15 font-medium text-rose-700 dark:text-rose-300"
                : "border-line bg-panel text-muted hover:border-rose-500/30"
            }`}
          >
            Urgences
          </button>
        </div>
      ) : null}

      {/* Liste des activités avec vue Timeline connectée */}
      {filteredMessages.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[11px] text-muted">
            {messages.length === 0
              ? "Aucune activité pour le moment. Partagez une note, posez une question ou taguez un membre de l'équipe."
              : "Aucune entrée ne correspond aux filtres sélectionnés."}
          </p>
        </div>
      ) : (
        <div className="relative px-5 pb-2">
          {/* Ligne verticale de la timeline */}
          <div
            className="pointer-events-none absolute top-4 bottom-4 left-9 w-px bg-line"
            aria-hidden="true"
          />

          <ul className="space-y-4">
            {filteredMessages.map((message) => {
              const isEvent = message.kind === "event";
              const parsed = parseMessageTag(message.body);
              const tagMeta = parsed.tag ? TAG_BADGES[parsed.tag] : null;
              const segments = parseBodyWithMentions(parsed.cleanBody, message.mentions);
              const EventIcon = getEventIcon(message.eventType);

              return (
                <li key={message.id} className="relative flex items-start gap-3.5">
                  {/* Nœud de timeline / Avatar */}
                  <div className="relative z-10 flex-shrink-0">
                    {isEvent ? (
                      <div className="grid size-8 place-items-center rounded-full border border-line bg-canvas text-muted shadow-xs">
                        <EventIcon className="size-3.5" aria-hidden="true" />
                      </div>
                    ) : (
                      <div className="grid size-8 place-items-center rounded-full border border-brand/20 bg-brand-soft text-[10px] font-bold text-brand-strong shadow-xs">
                        {getInitials(message.authorName)}
                      </div>
                    )}
                  </div>

                  {/* Carte d'information */}
                  <div
                    className={`min-w-0 flex-1 rounded-xl border p-3.5 transition-colors ${
                      isEvent
                        ? "border-line/70 bg-canvas/60 text-muted"
                        : "border-line bg-panel hover:border-brand/25"
                    }`}
                  >
                    {/* En-tête du message */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground text-[11px] font-semibold">
                        {message.authorName ?? (isEvent ? "Système" : "Utilisateur supprimé")}
                      </span>

                      {/* Rôle du membre */}
                      {!isEvent && message.authorRole ? (
                        <span className="py-0.2 rounded-full border border-line bg-canvas px-1.5 text-[8px] tracking-wide text-muted uppercase">
                          {ROLE_LABELS[message.authorRole] ?? message.authorRole}
                        </span>
                      ) : null}

                      {/* Badge Événement ou Tag de message */}
                      {isEvent ? (
                        <span className="py-0.2 rounded-full border border-line bg-canvas px-1.5 text-[8px] tracking-wide text-muted uppercase">
                          Jalon système
                        </span>
                      ) : tagMeta ? (
                        <span
                          className={`py-0.2 inline-flex items-center gap-1 rounded-full border px-2 text-[9px] font-medium tracking-wide uppercase ${tagMeta.className}`}
                        >
                          {tagMeta.label}
                        </span>
                      ) : null}

                      {/* Date & Temps relatif */}
                      <span
                        className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-muted"
                        title={FULL_DATE_FORMAT.format(message.createdAt)}
                      >
                        <Clock className="size-2.5 opacity-60" aria-hidden="true" />
                        {formatRelativeTime(message.createdAt)}
                      </span>

                      {/* Bouton de copie du message */}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(message.id, message.body)}
                        aria-label="Copier le message"
                        title="Copier le message"
                        className="grid size-6 place-items-center rounded border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                      >
                        {copiedId === message.id ? (
                          <Check className="size-3 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {/* Corps du message avec surlignage des mentions */}
                    <div className="text-foreground/90 mt-1.5 text-[11px] leading-relaxed whitespace-pre-line">
                      {segments.map((segment, index) => {
                        if (segment.type === "mention") {
                          return (
                            <span
                              key={index}
                              className="inline-flex items-center gap-0.5 rounded border border-brand/20 bg-brand-soft/75 px-1.5 py-0.5 align-baseline text-[10px] font-medium text-brand-strong"
                            >
                              <AtSign className="size-2.5" aria-hidden="true" />
                              {segment.value}
                            </span>
                          );
                        }
                        return <span key={index}>{segment.value}</span>;
                      })}
                    </div>

                    {/* Personnes mentionnées / taguées en pied de carte */}
                    {message.mentions.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2 text-[10px]">
                        <span className="flex items-center gap-1 font-medium text-muted">
                          <Users className="size-3" aria-hidden="true" />
                          Tagué{message.mentions.length > 1 ? "s" : ""} :
                        </span>
                        {message.mentions.map((men) => (
                          <span
                            key={men.userId}
                            className="text-foreground inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px]"
                          >
                            <span className="grid size-3 place-items-center rounded-full bg-brand-soft text-[7px] font-bold text-brand">
                              {getInitials(men.name)}
                            </span>
                            {men.name}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Accusés de réception express (Le truc spécial !) */}
                    {!isEvent && onQuickReply ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-line/40 pt-2 text-[10px] text-muted">
                        <span className="mr-1 text-[9px] text-muted">Réponse rapide :</span>
                        <button
                          type="button"
                          onClick={() =>
                            onQuickReply(`Vu 👍 pour le message de ${message.authorName}`)
                          }
                          aria-label={`Accuser réception du message de ${message.authorName}`}
                          title={`Accuser réception : "Vu 👍"`}
                          className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          Vu 👀
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onQuickReply(`Validé ✅ suite au message de ${message.authorName}`)
                          }
                          aria-label={`Valider suite au message de ${message.authorName}`}
                          title={`Validation rapide : "Validé ✅"`}
                          className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          Validé ✅
                        </button>
                        <button
                          type="button"
                          onClick={() => onQuickReply(`En cours de traitement ⏳`)}
                          aria-label="Indiquer en cours de traitement"
                          title="Indiquer en cours de traitement ⏳"
                          className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          En cours ⏳
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
