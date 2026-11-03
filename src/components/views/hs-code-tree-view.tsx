import Link from "next/link";
import { hsUsageLabel } from "@/modules/catalog/hs-codes";
import { groupHsCodesByChapter } from "@/modules/catalog/hs-code-tree";
import type { HsCodeListRow } from "@/modules/catalog/queries";

function HsCodeLine({ row, heading = false }: { row: HsCodeListRow; heading?: boolean }) {
  const tec = row.tecRate === null ? "TEC manquant" : `TEC ${row.tecRate} %`;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Link
        href={`/nomenclature/${row.id}`}
        className={`font-mono text-brand-strong transition-opacity hover:opacity-80 ${
          heading ? "text-[11px]" : "text-[10px]"
        }`}
      >
        {row.code}
      </Link>
      <span className={heading ? "text-[11px] font-medium" : "text-[11px]"}>{row.wording}</span>
      <span className="text-[10px] text-muted">· {tec}</span>
      <span className="text-[10px] text-muted">· {hsUsageLabel(row.usage)}</span>
    </div>
  );
}

/**
 * ART-020 — la vue hiérarchique range le jeu filtré en chapitres, puis en positions de tête et en
 * lignes plus fines : la nomenclature se lit comme un arbre, pas comme un mur de codes.
 */
export function HsCodeTreeView({ rows }: { rows: readonly HsCodeListRow[] }) {
  const chapters = groupHsCodesByChapter(rows);

  return (
    <div className="divide-y divide-line">
      {chapters.map((chapter) => (
        <section key={chapter.chapter} className="px-5 py-4">
          <h3 className="font-mono text-[10px] tracking-[0.12em] text-brand uppercase">
            Chapitre {chapter.chapter}
          </h3>
          <div className="mt-3 space-y-4">
            {chapter.groups.map((group) => (
              <div key={group.key}>
                {group.heading ? (
                  <HsCodeLine row={group.heading} heading />
                ) : (
                  <p className="font-mono text-[10px] text-muted">
                    Position {group.key} non importée
                  </p>
                )}
                {group.rows.length > 0 ? (
                  <ul className="mt-1 space-y-1 border-l border-line pl-3">
                    {group.rows.map((row) => (
                      <li key={row.id}>
                        <HsCodeLine row={row} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
