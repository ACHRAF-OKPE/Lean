import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AtSign, Bell, Check, CheckCheck, Inbox } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { discussionHref } from "@/lib/discussion/paths";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/discussion/actions";
import { entityLabel } from "@/modules/discussion/constants";
import {
  countUnreadNotifications,
  listNotifications,
  type NotificationSummary,
} from "@/modules/discussion/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Notifications",
};

const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

const ICON_BUTTON =
  "grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const KIND_META = {
  mention: {
    label: "Mention",
    icon: AtSign,
    className: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  event: {
    label: "Événement",
    icon: Bell,
    className: "border-line bg-canvas text-muted",
  },
} as const;

export default function NotificationsPage() {
  return (
    <Suspense fallback={<NotificationsFallback />}>
      <NotificationsContent />
    </Suspense>
  );
}

function NotificationsFallback() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
      <div className="h-6 w-48 animate-pulse rounded bg-line" />
      <div className="mt-6 h-64 animate-pulse rounded-xl border border-line bg-panel" />
    </main>
  );
}

async function NotificationsContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [notifications, unread, memberships] = await Promise.all([
    listNotifications(db, { tenantId: session.tenantId, userId: session.userId }),
    countUnreadNotifications(db, { tenantId: session.tenantId, userId: session.userId }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="notifications" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Activité de l&apos;espace
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">Notifications</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
              <Bell className="size-3" aria-hidden="true" />
              {unread} non lue{unread > 1 ? "s" : ""} sur {notifications.length}
            </span>
            {unread > 0 ? (
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

        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque commentaire qui vous mentionne et chaque étape d&apos;un document de l&apos;espace
          produit une notification. Le compteur de la cloche reflète vos notifications non lues.
        </p>

        {notifications.length === 0 ? (
          <section className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <Inbox className="size-5 text-muted" aria-hidden="true" />
            <p className="text-[11px] text-muted">
              Aucune notification. Mentionnez un collègue dans une discussion ou faites avancer un
              document pour alimenter cette boîte.
            </p>
          </section>
        ) : (
          <ul className="mt-5 space-y-2">
            {notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function NotificationRow({ notification }: { notification: NotificationSummary }) {
  const meta = KIND_META[notification.kind];
  const Icon = meta.icon;
  const unread = notification.readAt === null;

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        unread ? "border-brand/20 bg-panel" : "border-line bg-panel/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] tracking-wide uppercase ${meta.className}`}
        >
          <Icon className="size-3" aria-hidden="true" />
          {meta.label}
        </span>
        <span className="text-[11px] font-medium">{notification.title}</span>
        {unread ? (
          <span aria-label="Non lue" className="size-1.5 rounded-full bg-brand" role="img" />
        ) : null}
        <span className="ml-auto font-mono text-[10px] text-muted">
          {DATE_TIME.format(notification.createdAt)}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-5 whitespace-pre-line">{notification.body}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href={discussionHref(notification.entityType, notification.entityId)}
          className="text-[10px] font-medium text-brand-strong hover:underline"
        >
          {entityLabel(notification.entityType)} · ouvrir la discussion
        </Link>
        <span className="text-[10px] text-muted">
          {notification.actorName ? `Par ${notification.actorName}` : "Système"}
        </span>
        {unread ? (
          <form action={markNotificationReadAction} className="ml-auto">
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
        ) : null}
      </div>
    </li>
  );
}
