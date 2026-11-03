import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { StockFilterBar } from "@/components/views/stock-filter-bar";
import { StockMoveGridView } from "@/components/views/stock-move-grid-view";
import { StockMoveListView } from "@/components/views/stock-move-list-view";
import { StockViewSwitcher } from "@/components/views/stock-view-switcher";
import { getDb } from "@/db/client";
import { canAccessModule, getAccessLevels, requireModule } from "@/lib/auth/session";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listStockLocations } from "@/modules/stock/locations";
import { parseStockFilters } from "@/modules/stock/filters";
import { listStockMoves } from "@/modules/stock/queries";

export const metadata: Metadata = {
  title: "Registre des mouvements",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const BANNERS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "cree", label: "Transfert enregistré." },
  { key: "ajuste", label: "Ajustement d'inventaire enregistré." },
  { key: "annule", label: "Mouvement annulé par un mouvement inverse." },
];

export default function StockRegisterPage(props: PageProps<"/stock/registre">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du registre…" />}>
      <StockRegisterContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function StockRegisterContent({
  searchParams,
}: Pick<PageProps<"/stock/registre">, "searchParams">) {
  await connection();
  const session = await requireModule("stock", "read");
  const query = await searchParams;
  const filters = parseStockFilters(query);
  const db = getDb();
  const [page, locations, memberships, levels, canWrite] = await Promise.all([
    listStockMoves(db, session.tenantId, filters),
    listStockLocations(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    canAccessModule(session, "stock", "write"),
  ]);
  const canManage = atLeast(levels.stock, "manage");
  const lines = BANNERS.filter((banner) => query[banner.key] !== undefined).map(
    (banner) => banner.label,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/stock"
              aria-label="Revenir au stock"
              title="Revenir au stock"
              className={ACTION_LINK}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Stock</p>
              <h1 className="text-2xl font-medium tracking-tight">Registre des mouvements</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {canWrite ? (
              <>
                <Link
                  href="/stock/transferts/nouveau"
                  aria-label="Nouveau transfert"
                  title="Nouveau transfert"
                  className={ACTION_LINK}
                >
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/stock/ajustements/nouveau"
                  aria-label="Nouvel ajustement d'inventaire"
                  title="Nouvel ajustement d'inventaire"
                  className={ACTION_LINK}
                >
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                </Link>
              </>
            ) : null}
            <StockViewSwitcher filters={filters} />
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque effet sur le stock écrit une ligne datée et numérotée. Un mouvement ne se modifie
          ni ne se supprime : une correction écrit l&apos;inverse et le relie à l&apos;origine. Le
          registre se filtre par texte, magasin, type et période.
        </p>

        {lines.length > 0 ? (
          <div className="mt-4 space-y-2">
            {lines.map((line) => (
              <p
                key={line}
                role="status"
                className="rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
              >
                {line}
              </p>
            ))}
          </div>
        ) : null}

        <div className="mt-5">
          <StockFilterBar filters={filters} locations={locations} />
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">
              {filters.view === "grille" ? "Mouvements par article" : "Lignes de mouvement"}
            </h2>
            <p className="text-[10px] text-muted">
              {page.total} {page.total > 1 ? "lignes" : "ligne"}
              {page.total > page.limit ? ` · ${page.limit} affichées` : ""}
            </p>
          </div>
          {page.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun mouvement pour ces critères. Une réception, un transfert ou un ajustement écrit
              le journal.
            </p>
          ) : filters.view === "grille" ? (
            <div className="p-4">
              <StockMoveGridView rows={page.rows} />
            </div>
          ) : (
            <StockMoveListView rows={page.rows} canManage={canManage} />
          )}
        </section>
      </main>
    </div>
  );
}
