import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowDownToLine, ArrowUpFromLine, Warehouse } from "lucide-react";
import type { StockMoveType } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getStockCounts, getStockOverview } from "@/modules/stock/queries";
import { formatQuantity } from "@/modules/stock/quantities";

export const metadata: Metadata = {
  title: "Stock",
};

const TH = "px-4 py-2.5 font-normal";

const MOVE_META: Record<
  StockMoveType,
  { label: string; icon: typeof ArrowDownToLine; className: string }
> = {
  incoming: {
    label: "Entrée",
    icon: ArrowDownToLine,
    className: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  outgoing: {
    label: "Sortie",
    icon: ArrowUpFromLine,
    className: "border-copper/15 bg-copper-soft text-copper",
  },
};

export default function StockPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du stock…" />}>
      <StockContent />
    </Suspense>
  );
}

async function StockContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [overview, counts, memberships] = await Promise.all([
    getStockOverview(db, session.tenantId),
    getStockCounts(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Stock</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Niveaux et journal</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Le stock disponible ne vit que dans les emplacements internes. Chaque effet écrit un
              mouvement daté et numéroté ; une correction écrit l&apos;inverse sans effacer
              l&apos;origine.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
            <Warehouse className="size-3" aria-hidden="true" />
            MAG · emplacement interne
          </span>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Articles en stock</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counts.stockedArticles}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Mouvements au journal</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counts.moves}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Lignes de niveau visibles</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.levels.length}</dd>
          </div>
        </dl>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Stock disponible</h2>
          </div>
          {overview.levels.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucun stock disponible. Une réception de commande fournisseur alimente le magasin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Niveaux de stock des emplacements internes</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Emplacement
                    </th>
                    <th scope="col" className={TH}>
                      Article
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Quantité
                    </th>
                    <th scope="col" className={TH}>
                      Unité
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.levels.map((level) => (
                    <tr
                      key={`${level.locationCode}-${level.articleCode}`}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-mono text-[10px] text-muted">
                          {level.locationCode}
                        </span>{" "}
                        {level.locationName}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[10px] text-muted">
                          {level.articleCode}
                        </span>{" "}
                        {level.articleName}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">
                        {formatQuantity(level.quantity)}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{level.unitCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Journal des mouvements</h2>
            <p className="text-[10px] text-muted">Lecture seule · 200 dernières lignes</p>
          </div>
          {overview.moves.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Le journal est vide. Chaque réception y écrit une entrée numérotée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Journal des mouvements de stock</caption>
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
                      Repère
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.moves.map((move) => {
                    const meta = MOVE_META[move.type];
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={`${move.id}-${move.articleCode}`}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                          {isoDateLabel(move.realDate)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                          {move.number}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${meta.className}`}
                          >
                            <Icon className="size-3" aria-hidden="true" />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                          {move.fromCode} → {move.toCode}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-[10px] text-muted">
                            {move.articleCode}
                          </span>{" "}
                          {move.articleName}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          {formatQuantity(move.qty)} {move.unitCode}
                        </td>
                        <td className="px-4 py-2.5">
                          {move.cancelsMoveId ? (
                            <span className="rounded-full border border-copper/15 bg-copper-soft px-2 py-0.5 text-[10px] text-copper">
                              Inverse
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
