import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listNotifications } from "@/modules/discussion/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { NotificationsView } from "@/components/notifications-view";

export const metadata: Metadata = {
  title: "Notifications",
};

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
  const [notifications, memberships] = await Promise.all([
    listNotifications(db, { tenantId: session.tenantId, userId: session.userId }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="notifications" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <NotificationsView notifications={notifications} />
      </main>
    </div>
  );
}
