import Link from "next/link";
import { formatXof } from "@/lib/money";
import { ARTICLE_TYPE_LABELS, unitLabel } from "@/modules/catalog/constants";
import type { ArticleSummary } from "@/modules/catalog/queries";

/** ART-013 — la grille montre chaque article en carte, pour parcourir le catalogue d'un coup d'œil. */
export function ArticleGridView({
  rows,
  categoryTitles,
}: {
  rows: readonly ArticleSummary[];
  categoryTitles: Readonly<Record<string, readonly { id: string; title: string }[]>>;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const titles = categoryTitles[row.id] ?? [];
        return (
          <li key={row.id} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                {row.code}
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  row.active
                    ? "border-line bg-canvas text-muted"
                    : "border-copper/15 bg-copper-soft text-copper"
                }`}
              >
                {row.active ? "Actif" : "Inactif"}
              </span>
            </div>

            <p className="mt-1.5 text-[12px] font-medium">
              <Link href={`/articles/${row.id}`} className="transition-colors hover:text-brand">
                {row.name}
              </Link>
            </p>

            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
              <span>{ARTICLE_TYPE_LABELS[row.type]}</span>
              <span aria-hidden="true">·</span>
              <span>{unitLabel(row.unitCode)}</span>
              {row.hsCode ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{row.hsCode}</span>
                </>
              ) : null}
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-[10px]">
              <div>
                <dt className="text-muted">Vente</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{formatXof(row.salePriceXof)}</dd>
              </div>
              <div>
                <dt className="text-muted">Achat</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {formatXof(row.purchasePriceXof)}
                </dd>
              </div>
            </dl>

            {titles.length > 0 ? (
              <p className="mt-3 flex flex-wrap gap-1">
                {titles.map((category) => (
                  <span
                    key={category.id}
                    className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-muted"
                  >
                    {category.title}
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
