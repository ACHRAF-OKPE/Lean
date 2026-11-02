import Link from "next/link";
import {
  TEAM_NAV_ITEM,
  AUDIT_NAV_ITEM,
  type ActiveSection,
  type NavItem,
} from "@/components/nav-items";

const RAIL_LINK = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] transition-colors";
const RAIL_ACTIVE = "bg-brand-soft font-medium text-brand-strong";
const RAIL_IDLE = "text-muted hover:bg-brand-soft/60 hover:text-brand-strong";

/** GEN-014 — rail de navigation permanent à gauche : sections autorisées en lecture, section courante marquée. */
export function AppNavRail({
  tenantName,
  items,
  active,
  showTeam,
  showAudit,
}: {
  tenantName: string;
  items: readonly NavItem[];
  active: ActiveSection;
  showTeam: boolean;
  showAudit: boolean;
}) {
  const entries: readonly NavItem[] = [
    ...items,
    ...(showTeam ? [TEAM_NAV_ITEM] : []),
    ...(showAudit ? [AUDIT_NAV_ITEM] : []),
  ];

  return (
    <nav
      data-nav-rail=""
      aria-label="Navigation principale"
      className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-panel px-3 py-4 lg:flex"
    >
      <div className="flex items-center gap-2.5 px-1 pb-4">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
        >
          L
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight">Lean</span>
          <span className="block truncate text-[10px] text-muted">{tenantName}</span>
        </span>
      </div>

      <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
        {entries.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`${RAIL_LINK} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
