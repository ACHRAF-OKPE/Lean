import { Suspense } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getDb } from "@/db/client";
import type { SessionContext } from "@/modules/identity/queries";
import { countUnreadNotifications } from "@/modules/discussion/queries";

const NAV_LINK = "relative grid size-9 place-items-center rounded-md border transition-colors";
const NAV_LINK_ACTIVE = "border-brand/20 bg-brand-soft text-brand-strong";
const NAV_LINK_IDLE = "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand";

export function NotificationBell({
  session,
  active = false,
}: {
  session: SessionContext;
  active?: boolean;
}) {
  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      title="Notifications"
      aria-current={active ? "page" : undefined}
      className={`${NAV_LINK} ${active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
    >
      <Bell className="size-4" aria-hidden="true" />
      <Suspense fallback={null}>
        <UnreadBadge session={session} />
      </Suspense>
    </Link>
  );
}

async function UnreadBadge({ session }: { session: SessionContext }) {
  const unread = await countUnreadNotifications(getDb(), {
    tenantId: session.tenantId,
    userId: session.userId,
  });
  if (unread === 0) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-copper px-1 text-[9px] leading-4 font-semibold text-canvas tabular-nums"
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}
