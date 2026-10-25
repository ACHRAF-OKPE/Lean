import Link from "next/link";
import {
  ArrowLeftRight,
  Barcode,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  ShoppingCart,
  Users,
  Warehouse,
} from "lucide-react";
import { logoutAction, switchTenantAction } from "@/lib/auth/actions";
import { can } from "@/modules/identity/permissions";
import type { MembershipSummary, SessionContext } from "@/modules/identity/queries";

export type ActiveSection =
  "home" | "partners" | "articles" | "nomenclature" | "purchases" | "stock" | "audit";

const NAV_ITEMS = [
  { key: "home", href: "/", label: "Poste de pilotage", icon: LayoutDashboard },
  { key: "partners", href: "/tiers", label: "Tiers", icon: Users },
  { key: "articles", href: "/articles", label: "Articles", icon: Package },
  { key: "nomenclature", href: "/nomenclature", label: "Nomenclature douanière", icon: Barcode },
  { key: "purchases", href: "/achats", label: "Achats", icon: ShoppingCart },
  { key: "stock", href: "/stock", label: "Stock", icon: Warehouse },
] as const;

const ICON_BUTTON =
  "grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const NAV_LINK = "grid size-9 place-items-center rounded-md border transition-colors";
const NAV_LINK_ACTIVE = "border-brand/20 bg-brand-soft text-brand-strong";
const NAV_LINK_IDLE = "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand";

export function AppHeader({
  session,
  memberships,
  active,
}: {
  session: SessionContext;
  memberships: readonly MembershipSummary[];
  active: ActiveSection;
}) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4 md:px-10">
        <Link href="/" className="order-1 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
          >
            L
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">Lean</span>
            <span className="block text-[11px] text-muted">ERP supply chain &amp; douane</span>
          </span>
        </Link>

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
          aria-label="Navigation principale"
          className="order-3 flex w-full items-center gap-1.5 border-t border-line pt-3 sm:order-2 sm:w-auto sm:border-0 sm:pt-0"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                aria-current={active === item.key ? "page" : undefined}
                className={`${NAV_LINK} ${active === item.key ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
              >
                <Icon className="size-4" aria-hidden="true" />
              </Link>
            );
          })}
          {can(session.role, "audit.read") ? (
            <Link
              href="/audit"
              aria-label="Journal d'audit"
              title="Journal d'audit"
              aria-current={active === "audit" ? "page" : undefined}
              className={`${NAV_LINK} ${active === "audit" ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
            >
              <ScrollText className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
