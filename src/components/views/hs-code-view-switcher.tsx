import Link from "next/link";
import { List, ListTree, type LucideIcon } from "lucide-react";
import {
  hsCodesHref,
  type HsCodeFilters,
  type HsCodeView,
} from "@/modules/catalog/hs-code-filters";

const VIEWS: readonly {
  readonly view: HsCodeView;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { view: "liste", label: "Vue liste", icon: List },
  { view: "arbre", label: "Vue hiérarchique", icon: ListTree },
];

/** ART-019 — la vue se choisit sans perdre les filtres : chaque lien reprend l'adresse courante. */
export function HsCodeViewSwitcher({ filters }: { filters: HsCodeFilters }) {
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
            href={hsCodesHref(filters, { view })}
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
