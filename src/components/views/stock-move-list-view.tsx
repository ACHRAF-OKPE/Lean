import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine } from "lucide-react";
import type { StockMoveType } from "@/db/schema";
import { CancelStockMoveButton } from "@/components/stock-forms";
import { isoDateLabel } from "@/lib/dates";
import type { StockMoveLineEntry } from "@/modules/stock/queries";
import { STOCK_MOVE_TYPE_LABELS } from "@/modules/stock/labels";
import { formatQuantity } from "@/modules/stock/quantities";

const TH = "px-4 py-2.5 font-normal";

const MOVE_META: Record<StockMoveType, { icon: typeof ArrowDownToLine; className: string }> = {
  incoming: {
    icon: ArrowDownToLine,
    className: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  outgoing: {
    icon: ArrowUpFromLine,
    className: "border-copper/15 bg-copper-soft text-copper",
  },
  transfer: {
    icon: ArrowLeftRight,
    className: "border-line bg-canvas text-muted",
  },
};

/** STK-009 — la vue liste présente chaque ligne de mouvement, annulation comprise. */
export function StockMoveListView({
  rows,
  canManage,
}: {
  rows: readonly StockMoveLineEntry[];
  canManage: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <caption className="sr-only">Registre des mouvements de stock</caption>
        <thead>
          <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
            <th scope="col" className={TH}>
              Date
            </th>
            <th scope="col" className={TH}>
              Numéro
            </th>
            <th scope="col" className={TH}>
              Type
            </th>
            <th scope="col" className={TH}>
              Trajet
            </th>
            <th scope="col" className={TH}>
              Article
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Quantité
            </th>
            <th scope="col" className={TH}>
              Note
            </th>
            {canManage ? (
              <th scope="col" className={`${TH} text-right`}>
                Action
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = MOVE_META[row.type];
            const Icon = meta.icon;
            return (
              <tr
                key={`${row.moveId}-${row.lineNumber}`}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                  {isoDateLabel(row.realDate)}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                  {row.number}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${meta.className}`}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                    {STOCK_MOVE_TYPE_LABELS[row.type]}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                  {row.fromCode} → {row.toCode}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[10px] text-muted">{row.articleCode}</span>{" "}
                  {row.articleName}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {formatQuantity(row.qty)} {row.unitCode}
                </td>
                <td className="max-w-[16rem] px-4 py-2.5 text-[10px] text-muted">
                  {row.cancelsMoveId ? (
                    <span className="rounded-full border border-copper/15 bg-copper-soft px-2 py-0.5 text-copper">
                      Mouvement inverse
                    </span>
                  ) : row.notes ? (
                    <span className="line-clamp-2">{row.notes}</span>
                  ) : null}
                </td>
                {canManage ? (
                  <td className="px-4 py-2.5 text-right">
                    {row.cancellable && row.lineNumber === 1 ? (
                      <div className="flex justify-end">
                        <CancelStockMoveButton moveId={row.moveId} number={row.number} compact />
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
