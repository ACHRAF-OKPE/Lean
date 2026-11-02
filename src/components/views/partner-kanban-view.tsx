import Link from "next/link";
import {
  groupPartnersByCategory,
  UNGROUPED_COLUMN,
  type KanbanItem,
} from "@/modules/catalog/kanban";

/** ART-011 — une colonne par catégorie de tiers ; les tiers sans catégorie ferment la rangée. */
export function PartnerKanbanView({
  rows,
  categoriesByPartner,
}: {
  rows: readonly KanbanItem[];
  categoriesByPartner: ReadonlyMap<string, readonly { id: string; title: string }[]>;
}) {
  const columns = groupPartnersByCategory(rows, categoriesByPartner);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-4">
        {columns.map((column) => (
          <section
            key={column.title}
            aria-label={`Catégorie ${column.title}`}
            className="w-64 shrink-0 rounded-xl border border-line bg-panel"
          >
            <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
              <h2 className="truncate text-[11px] font-medium">
                {column.title}
                {column.title === UNGROUPED_COLUMN ? (
                  <span className="ml-1.5 text-[10px] font-normal text-muted">à classer</span>
                ) : null}
              </h2>
              <span className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                {column.items.length}
              </span>
            </header>

            <ul className="space-y-2 p-2.5">
              {column.items.map((item) => (
                <li key={item.id} className="rounded-lg border border-line bg-canvas px-3 py-2.5">
                  <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                    {item.code}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium">
                    <Link href={`/tiers/${item.id}`} className="transition-colors hover:text-brand">
                      {item.name}
                    </Link>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    {item.isCustomer ? <span>Client</span> : null}
                    {item.isCustomer && item.isSupplier ? <span aria-hidden="true">·</span> : null}
                    {item.isSupplier ? <span>Fournisseur</span> : null}
                    <span aria-hidden="true">·</span>
                    <span>{[item.city, item.countryCode].filter(Boolean).join(" · ") || "—"}</span>
                    {item.active ? null : <span className="text-copper">inactif</span>}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
