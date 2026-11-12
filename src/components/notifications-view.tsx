"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AtSign,
  Bell,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  Filter,
  Inbox,
  Receipt,
  Search,
  ShoppingCart,
  ShoppingBag,
  Users,
} from "lucide-react";
import type { DiscussionEntityType } from "@/db/schema";
import type { NotificationSummary } from "@/modules/discussion/queries";
import { discussionHref } from "@/lib/discussion/paths";
import { entityLabel } from "@/modules/discussion/constants";
import { parseMessageTag, type MessageTag } from "@/modules/discussion/tags";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/discussion/actions";

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

const ICON_BUTTON =
  "grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const ENTITY_CONFIG: Record<
  DiscussionEntityType,
  { label: string; icon: typeof ShoppingCart; className: string }
> = {
  purchase_order: {
    label: "Achats",
    icon: ShoppingCart,
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  sales_order: {
    label: "Ventes",
    icon: ShoppingBag,
    className: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  invoice: {
    label: "Factures",
    icon: Receipt,
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  task: {
    label: "Tâches",
    icon: CheckSquare,
    className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  partner: {
    label: "Tiers",
    icon: Users,
    className: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
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

export function NotificationsView({
  notifications,
}: {
  readonly notifications: readonly NotificationSummary[];
}) {
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "mentions" | "events" | "tasks">(
    "all",
  );
  const [selectedEntity, setSelectedEntity] = useState<"all" | DiscussionEntityType>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const searchInputId = useId();

  // Compteurs pour chaque catégorie
  const counts = useMemo(() => {
    let unread = 0;
    let mentions = 0;
    let events = 0;
    let tasks = 0;
    for (const n of notifications) {
      if (n.readAt === null) unread++;
      if (n.kind === "mention") mentions++;
      if (n.kind === "event") events++;
      if (n.entityType === "task") tasks++;
    }
    return {
      all: notifications.length,
      unread,
      mentions,
      events,
      tasks,
    };
  }, [notifications]);

  // Filtrage combiné
  const filtered = useMemo(() => {
    let list = [...notifications];

    // Onglet
    if (activeTab === "unread") {
      list = list.filter((n) => n.readAt === null);
    } else if (activeTab === "mentions") {
      list = list.filter((n) => n.kind === "mention");
    } else if (activeTab === "events") {
      list = list.filter((n) => n.kind === "event");
    } else if (activeTab === "tasks") {
      list = list.filter((n) => n.entityType === "task");
    }

    // Type d'entité
    if (selectedEntity !== "all") {
      list = list.filter((n) => n.entityType === selectedEntity);
    }

    // Recherche
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((n) => {
        const matchTitle = n.title.toLowerCase().includes(q);
        const matchBody = n.body.toLowerCase().includes(q);
        const matchActor = n.actorName?.toLowerCase().includes(q) ?? false;
        return matchTitle || matchBody || matchActor;
      });
    }

    return list;
  }, [notifications, activeTab, selectedEntity, searchQuery]);

  return (
    <div className="space-y-6">
      {/* En-tête et commande globale */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
            Centre de communication &amp; notifications
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Notifications</h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-[10px] text-muted">
            <Bell className="size-3 text-brand" aria-hidden="true" />
            <strong className="text-foreground">{counts.unread}</strong> non lue
            {counts.unread > 1 ? "s" : ""} sur {counts.all}
          </span>

          {counts.unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <button
                type="submit"
                aria-label="Tout marquer comme lu"
                title="Tout marquer comme lu"
                className={ICON_BUTTON}
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Onglets de classification */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            aria-label="Toutes les notifications"
            title="Toutes les notifications"
            className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "all"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-panel"
            }`}
          >
            Toutes ({counts.all})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("unread")}
            aria-label="Notifications non lues"
            title="Notifications non lues"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "unread"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-panel"
            }`}
          >
            {counts.unread > 0 ? (
              <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
            ) : null}
            Non lues ({counts.unread})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("mentions")}
            aria-label="Mentions directes (@)"
            title="Mentions directes où vous êtes cité"
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "mentions"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-panel"
            }`}
          >
            <AtSign className="size-3" aria-hidden="true" />
            Mentions (@) ({counts.mentions})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("events")}
            aria-label="Événements métier"
            title="Événements automatiques du système"
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "events"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-panel"
            }`}
          >
            <Activity className="size-3" aria-hidden="true" />
            Événements ({counts.events})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("tasks")}
            aria-label="Notifications de tâches"
            title="Notifications liées aux tâches"
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === "tasks"
                ? "border border-brand/20 bg-brand-soft text-brand-strong"
                : "border border-transparent text-muted hover:border-line hover:bg-panel"
            }`}
          >
            <CheckSquare className="size-3" aria-hidden="true" />
            Tâches ({counts.tasks})
          </button>
        </div>

        {/* Champ de recherche en temps réel */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrer les notifications..."
            aria-label="Filtrer les notifications par mot-clé"
            className="text-foreground h-8 w-44 rounded-md border border-line bg-panel pr-2.5 pl-8 text-[11px] transition-all placeholder:text-muted focus:w-56 focus:border-brand/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Filtres par domaine de document */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <span className="mr-1 flex items-center gap-1 font-medium text-muted">
          <Filter className="size-3" aria-hidden="true" />
          Domaine :
        </span>
        <button
          type="button"
          onClick={() => setSelectedEntity("all")}
          aria-label="Tous les domaines"
          title="Tous les domaines"
          className={`rounded-full border px-2.5 py-0.5 transition-colors ${
            selectedEntity === "all"
              ? "border-brand/30 bg-brand-soft font-medium text-brand-strong"
              : "border-line bg-panel text-muted hover:border-brand/20"
          }`}
        >
          Tous
        </button>

        {(Object.keys(ENTITY_CONFIG) as DiscussionEntityType[]).map((type) => {
          const conf = ENTITY_CONFIG[type];
          const Icon = conf.icon;
          const isSelected = selectedEntity === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedEntity(isSelected ? "all" : type)}
              aria-label={`Filtrer par ${conf.label}`}
              title={`Filtrer par ${conf.label}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-colors ${
                isSelected
                  ? "border-brand/40 bg-brand-soft font-semibold text-brand-strong shadow-xs"
                  : "border-line bg-panel text-muted hover:border-brand/20"
              }`}
            >
              <Icon className="size-2.5" aria-hidden="true" />
              {conf.label}
            </button>
          );
        })}
      </div>

      {/* Liste des notifications */}
      {filtered.length === 0 ? (
        <section className="flex flex-col items-center gap-2.5 rounded-xl border border-line bg-panel px-5 py-14 text-center">
          <Inbox className="size-6 text-muted" aria-hidden="true" />
          <h2 className="text-foreground text-xs font-semibold">Boîte de notifications propre</h2>
          <p className="max-w-md text-[11px] text-muted">
            {notifications.length === 0
              ? "Aucune notification enregistrée. Dès qu'un collègue vous mentionne ou qu'un dossier évolue, l'information s'affichera ici."
              : "Aucune notification ne correspond aux critères de filtre appliqués."}
          </p>
        </section>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((notification) => {
            const isUnread = notification.readAt === null;
            const entityConf = ENTITY_CONFIG[notification.entityType];
            const EntityIcon = entityConf.icon;
            const parsed = parseMessageTag(notification.body);
            const tagMeta = parsed.tag ? TAG_BADGES[parsed.tag] : null;

            return (
              <li
                key={notification.id}
                className={`rounded-xl border p-4 transition-all ${
                  isUnread
                    ? "border-brand/25 bg-panel shadow-xs"
                    : "border-line bg-panel/60 opacity-90 hover:opacity-100"
                }`}
              >
                {/* Ligne 1 : Badges & Statut */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Badge d'entité / document */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase ${entityConf.className}`}
                  >
                    <EntityIcon className="size-2.5" aria-hidden="true" />
                    {entityConf.label}
                  </span>

                  {/* Badge Mention ou Événement */}
                  {notification.kind === "mention" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft px-2 py-0.5 text-[9px] font-medium tracking-wide text-brand-strong uppercase">
                      <AtSign className="size-2.5" aria-hidden="true" />
                      Mention
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[9px] tracking-wide text-muted uppercase">
                      <Bell className="size-2.5" aria-hidden="true" />
                      Événement
                    </span>
                  )}

                  {/* Badge Tag si présent */}
                  {tagMeta ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase ${tagMeta.className}`}
                    >
                      {tagMeta.label}
                    </span>
                  ) : null}

                  {/* Titre */}
                  <span className="text-foreground text-[11px] font-semibold">
                    {notification.title}
                  </span>

                  {/* Puce non lue */}
                  {isUnread ? (
                    <span
                      aria-label="Non lue"
                      title="Notification non lue"
                      className="size-2 rounded-full bg-brand ring-2 ring-brand-soft"
                      role="img"
                    />
                  ) : null}

                  {/* Horodatage */}
                  <span
                    className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-muted"
                    title={FULL_DATE_FORMAT.format(notification.createdAt)}
                  >
                    <Clock className="size-2.5 opacity-60" aria-hidden="true" />
                    {formatRelativeTime(notification.createdAt)}
                  </span>
                </div>

                {/* Corps de la notification */}
                <p className="text-foreground/90 mt-2 text-[11px] leading-relaxed whitespace-pre-line">
                  {parsed.cleanBody}
                </p>

                {/* Ligne 3 : Liens d'action et auteur */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-2 text-[10px]">
                  <div className="flex items-center gap-3">
                    <Link
                      href={discussionHref(notification.entityType, notification.entityId)}
                      className="font-medium text-brand-strong hover:underline"
                    >
                      {entityLabel(notification.entityType)} · Ouvrir la discussion
                    </Link>

                    <span className="text-muted">
                      {notification.actorName
                        ? `Par ${notification.actorName}`
                        : "Système automatique"}
                    </span>
                  </div>

                  {/* Marquer comme lu */}
                  {isUnread ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <button
                        type="submit"
                        aria-label="Marquer comme lue"
                        title="Marquer comme lue"
                        className={ICON_BUTTON}
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                      </button>
                    </form>
                  ) : (
                    <span className="font-mono text-[9px] text-muted">Lue</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
