import Link from "next/link";
import { Grid3x3, LayoutGrid, List, type LucideIcon } from "lucide-react";
import {
  articlesHref,
  type ArticleFilters,
  type ArticleView,
} from "@/modules/catalog/article-filters";

const VIEWS: readonly {
  readonly view: ArticleView;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { view: "liste", label: "Vue liste", icon: List },
  { view: "kanban", label: "Vue Kanban", icon: LayoutGrid },
  { view: "grille", label: "Vue grille", icon: Grid3x3 },
];

/** ART-013 — la vue se choisit sans perdre les filtres : chaque lien reprend l'adresse courante. */
export function ArticleViewSwitcher({ filters }: { filters: ArticleFilters }) {
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
            href={articlesHref(filters, { view })}
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
