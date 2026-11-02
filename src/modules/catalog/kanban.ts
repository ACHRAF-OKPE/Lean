/** ART-011 — la vue Kanban du registre se groupe par catégorie de tiers. */
export const UNGROUPED_COLUMN = "Sans catégorie";

export interface KanbanItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isCustomer: boolean;
  readonly isSupplier: boolean;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly active: boolean;
}

export interface KanbanColumn {
  readonly title: string;
  readonly categoryId: string | null;
  readonly items: readonly KanbanItem[];
}

/** Une colonne par catégorie posée sur au moins un tiers ; « Sans catégorie » termine la rangée. */
export function groupPartnersByCategory(
  rows: readonly KanbanItem[],
  categoriesByPartner: ReadonlyMap<string, readonly { id: string; title: string }[]>,
): readonly KanbanColumn[] {
  const columns = new Map<string, { categoryId: string | null; items: KanbanItem[] }>();

  for (const row of rows) {
    const categories = categoriesByPartner.get(row.id) ?? [];
    const buckets =
      categories.length === 0
        ? [{ id: null as string | null, title: UNGROUPED_COLUMN }]
        : categories;

    for (const bucket of buckets) {
      const existing = columns.get(bucket.title) ?? { categoryId: bucket.id, items: [] };
      existing.items.push(row);
      columns.set(bucket.title, existing);
    }
  }

  return [...columns.entries()]
    .map(([title, column]) => ({ title, categoryId: column.categoryId, items: column.items }))
    .sort((a, b) => {
      if (a.title === UNGROUPED_COLUMN) return 1;
      if (b.title === UNGROUPED_COLUMN) return -1;
      return a.title.localeCompare(b.title, "fr");
    });
}
