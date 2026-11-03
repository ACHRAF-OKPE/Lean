import { Package } from "lucide-react";
import type { StockMoveLineEntry } from "@/modules/stock/queries";
import { formatQuantity, microsToQuantity, quantityToMicros } from "@/modules/stock/quantities";

interface ArticleBucket {
  readonly code: string;
  readonly name: string;
  readonly unitCode: string;
  micros: bigint;
  moveCount: number;
  lineCount: number;
}

/** STK-009 — la vue grille regroupe le jeu filtré par article et totalise la quantité déplacée. */
export function StockMoveGridView({ rows }: { rows: readonly StockMoveLineEntry[] }) {
  const buckets = new Map<string, ArticleBucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.articleId);
    if (!bucket) {
      bucket = {
        code: row.articleCode,
        name: row.articleName,
        unitCode: row.unitCode,
        micros: 0n,
        moveCount: 0,
        lineCount: 0,
      };
      buckets.set(row.articleId, bucket);
    }
    bucket.micros += quantityToMicros(row.qty);
    bucket.lineCount += 1;
  }

  const moveIdsByArticle = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = moveIdsByArticle.get(row.articleId);
    if (!set) {
      set = new Set<string>();
      moveIdsByArticle.set(row.articleId, set);
    }
    set.add(row.moveId);
  }
  for (const [articleId, set] of moveIdsByArticle) {
    const bucket = buckets.get(articleId);
    if (bucket) {
      bucket.moveCount = set.size;
    }
  }

  const cards = [...buckets.entries()].sort((left, right) =>
    left[1].name.localeCompare(right[1].name, "fr"),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(([articleId, bucket]) => (
        <article
          key={articleId}
          className="rounded-xl border border-line bg-panel p-4 transition-colors hover:border-brand/30"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-brand" aria-hidden="true" />
              <div>
                <p className="font-mono text-[10px] text-muted">{bucket.code}</p>
                <h3 className="text-sm font-medium">{bucket.name}</h3>
              </div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-[10px] text-muted">Quantité déplacée</dt>
              <dd className="mt-0.5 font-mono tabular-nums">
                {formatQuantity(microsToQuantity(bucket.micros))} {bucket.unitCode}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-muted">Mouvements</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{bucket.moveCount}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
