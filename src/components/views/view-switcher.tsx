import Link from "next/link";
import { LayoutGrid, List, Map, type LucideIcon } from "lucide-react";
import { partnersHref, type PartnerFilters, type PartnerView } from "@/modules/catalog/filters";

const VIEWS: readonly {
  readonly view: PartnerView;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { view: "liste", label: "Vue liste", icon: List },
  { view: "kanban", label: "Vue Kanban", icon: LayoutGrid },
  { view: "carte", label: "Vue carte", icon: Map },
];

/** GEN-016 — la vue se choisit sans perdre les filtres : chaque lien reprend l'adresse courante. */
export function ViewSwitcher({ filters }: { filters: PartnerFilters }) {
  return (
    <div
      role="group"
      aria-label="Choix de la vue"
      className="flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5"
    >
      {VIEWS.map(({ view, label, icon: Icon }) => {
        const active = filters.view === view;
        return (
          <Link
            key={view}
            href={partnersHref(filters, { view })}
            aria-current={active ? "true" : undefined}
            aria-label={label}
            title={label}
            className={`grid size-8 place-items-center rounded transition-colors ${
              active ? "bg-brand-soft text-brand-strong" : "text-muted hover:text-brand"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}
