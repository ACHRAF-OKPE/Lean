import type { ArticleType } from "@/db/schema";
import { groupByCategory, UNGROUPED_COLUMN } from "./kanban";

export { UNGROUPED_COLUMN };

/** ART-014 — la carte d'article telle que la colonne la montre. */
export interface ArticleKanbanItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly salePriceXof: number;
  readonly active: boolean;
}

export interface ArticleKanbanColumn {
  readonly title: string;
  readonly categoryId: string | null;
  readonly items: readonly ArticleKanbanItem[];
}

/** ART-014 — une colonne par catégorie d'articles ; les articles sans catégorie ferment la rangée. */
export function groupArticlesByCategory(
  rows: readonly ArticleKanbanItem[],
  categoriesByArticle: ReadonlyMap<string, readonly { id: string; title: string }[]>,
): readonly ArticleKanbanColumn[] {
  return groupByCategory(rows, categoriesByArticle);
}
