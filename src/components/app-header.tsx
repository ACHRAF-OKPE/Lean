import Link from "next/link";
import { ArrowLeftRight, GitBranch, LogOut } from "lucide-react";
import { getAccessLevels } from "@/lib/auth/session";
import { logoutAction, switchTenantAction } from "@/lib/auth/actions";
import { can } from "@/modules/identity/permissions";
import type { MembershipSummary, SessionContext } from "@/modules/identity/queries";
import { AppNavRail } from "./app-nav-rail";
import { NotificationBell } from "./notification-bell";
import {
  AUDIT_NAV_ITEM,
  TEAM_NAV_ITEM,
  visibleNavItems,
  type ActiveSection,
  type NavItem,
} from "./nav-items";

const ICON_BUTTON =
  "grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export async function AppHeader({
  session,
  memberships,
  active,
}: {
  session: SessionContext;
  memberships: readonly MembershipSummary[];
  active: ActiveSection;
}) {
  const levels = await getAccessLevels(session);
  const items = visibleNavItems(levels);
  const showTeam = can(session.role, "members.read");
  const showAudit = can(session.role, "audit.read");

  return (
    <>
      <AppNavRail
        tenantName={session.tenantName}
        items={items}
        active={active}
        showTeam={showTeam}
        showAudit={showAudit}
      />

      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4 md:px-10">
          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            <span className="hidden max-w-40 truncate rounded-full border border-line bg-panel px-3 py-1.5 text-[10px] text-muted md:inline-block">
              {session.tenantName}
            </span>
            {memberships.length > 1 ? (
              <form action={switchTenantAction} className="flex items-center gap-1.5">
                <label htmlFor="tenantId" className="sr-only">
                  Espace de travail
                </label>
                <select
                  id="tenantId"
                  name="tenantId"
                  defaultValue={session.tenantId}
                  className="max-w-28 rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
                >
                  {memberships.map((membership) => (
                    <option key={membership.tenantId} value={membership.tenantId}>
                      {membership.tenantName}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  aria-label="Changer d'espace de travail"
                  title="Changer d'espace de travail"
                  className={ICON_BUTTON}
                >
                  <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                </button>
              </form>
            ) : null}
            <a
              href="https://github.com/ACHRAF-OKPE/Lean"
              target="_blank"
              rel="noreferrer"
              aria-label="Ouvrir le dépôt GitHub"
              title="Dépôt GitHub"
              className={`${ICON_BUTTON} hidden sm:grid`}
            >
              <GitBranch className="size-4" aria-hidden="true" />
            </a>
            <NotificationBell session={session} active={active === "notifications"} />
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="Se déconnecter"
                title="Se déconnecter"
                className={ICON_BUTTON}
              >
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            </form>
          </div>

          <nav
            aria-label="Navigation compacte"
            className="order-3 flex w-full items-center gap-1.5 border-t border-line pt-3 sm:order-2 sm:w-auto sm:border-0 sm:pt-0 lg:hidden"
          >
            <Link
              href="/"
              aria-label="Poste de pilotage"
              title="Poste de pilotage"
              className="mr-1 grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
            >
              L
            </Link>
            {items.map((item) => (
              <CompactLink key={item.key} item={item} active={active} />
            ))}
            {showTeam ? <CompactLink item={TEAM_NAV_ITEM} active={active} /> : null}
            {showAudit ? <CompactLink item={AUDIT_NAV_ITEM} active={active} /> : null}
          </nav>
        </div>
      </header>
    </>
  );
}

function CompactLink({ item, active }: { item: NavItem; active: ActiveSection }) {
  const Icon = item.icon;
  const isActive = active === item.key;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      title={item.label}
      aria-current={isActive ? "page" : undefined}
      className={`grid size-9 place-items-center rounded-md border transition-colors ${
        isActive
          ? "border-brand/20 bg-brand-soft text-brand-strong"
          : "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand"
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Link>
  );
}
