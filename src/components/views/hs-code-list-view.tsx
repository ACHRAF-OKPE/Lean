import Link from "next/link";
import { hsLevel, hsUsageLabel, type HsLevel } from "@/modules/catalog/hs-codes";
import type { HsCodeListRow } from "@/modules/catalog/queries";

const TH = "px-4 py-2.5 font-normal";

const LEVEL_LABELS: Record<HsLevel, string> = {
  6: "Position",
  8: "Sous-position",
  10: "Ligne",
};

/** ART-019 — le registre en liste : chaque code mène à sa fiche et montre son usage. */
export function HsCodeListView({ rows }: { rows: readonly HsCodeListRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <caption className="sr-only">Nomenclature douanière de l&apos;espace actif</caption>
        <thead>
          <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
            <th scope="col" className={TH}>
              Code SH
            </th>
            <th scope="col" className={TH}>
              Libellé
            </th>
            <th scope="col" className={TH}>
              Niveau
            </th>
            <th scope="col" className={TH}>
              Parent
            </th>
            <th scope="col" className={TH}>
              Unité
            </th>
            <th scope="col" className={TH}>
              TEC
            </th>
            <th scope="col" className={TH}>
              Usage
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const level = hsLevel(row.code);
            return (
              <tr key={row.id} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                  <Link
                    href={`/nomenclature/${row.id}`}
                    className="text-brand-strong transition-opacity hover:opacity-80"
                  >
                    {row.code}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium">{row.wording}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                  {level === null ? "Non conforme" : LEVEL_LABELS[level]}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                  {row.parentCode ?? "Aucun"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                  {row.supplementaryUnit ?? "Non renseignée"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                  {row.tecRate === null ? "Non renseigné" : `${row.tecRate} %`}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                  {hsUsageLabel(row.usage)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
