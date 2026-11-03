import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { StockLocationRenameForm, StockLocationToggleButton } from "@/components/stock-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getStockLocationDetail } from "@/modules/stock/locations";
import { formatQuantity } from "@/modules/stock/quantities";

export const metadata: Metadata = {
  title: "Fiche magasin",
};

const TH = "px-4 py-2.5 font-normal";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function StockLocationPage(props: PageProps<"/stock/magasins/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la fiche…" />}>
      <StockLocationContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function StockLocationContent({
  params,
  searchParams,
}: Pick<PageProps<"/stock/magasins/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("stock", "read");
  const [{ id: locationId }, query] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(locationId)) {
    notFound();
  }

  const db = getDb();
  const [location, memberships, levels] = await Promise.all([
    getStockLocationDetail(db, session.tenantId, locationId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  if (!location) {
    notFound();
  }
  const canManage = atLeast(levels.stock, "manage");
  const created = query.cree !== undefined;
  const updated = query.maj !== undefined;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/stock/magasins"
              aria-label="Revenir aux magasins"
              title="Revenir aux magasins"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                {location.code}
              </p>
              <h1 className="text-2xl font-medium tracking-tight">{location.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] whitespace-nowrap ${
                location.active
                  ? "border-brand/15 bg-brand-soft text-brand-strong"
                  : "border-line bg-canvas text-muted"
              }`}
            >
              {location.active ? "Actif" : "Inactif"}
            </span>
            {canManage ? (
              <StockLocationToggleButton
                locationId={location.id}
                code={location.code}
                active={location.active}
              />
            ) : null}
          </div>
        </div>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Magasin créé.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Nom mis à jour. Le code reste immuable.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Articles en stock</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{location.articleCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Quantité totale</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {formatQuantity(location.totalQuantity)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Mouvements</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{location.moveCount}</dd>
          </div>
        </dl>

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Renommer le magasin</h2>
            <StockLocationRenameForm locationId={location.id} name={location.name} />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Stock disponible</h2>
            <p className="text-[10px] text-muted">{location.levels.length} article(s)</p>
          </div>
          {location.levels.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Ce magasin ne porte aucun stock.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Niveaux de stock du magasin {location.code}</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
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
                  {location.levels.map((level) => (
                    <tr key={level.articleCode} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[10px] text-muted">
                          {level.articleCode}
                        </span>{" "}
                        {level.articleName}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
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

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Derniers mouvements</h2>
            <Link
              href={`/stock/registre?magasin=${location.id}`}
              className="text-[10px] text-muted underline transition-colors hover:text-brand"
            >
              Filtrer le registre
            </Link>
          </div>
          {location.moves.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucun mouvement sur ce magasin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Quarante derniers mouvements du magasin {location.code}
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Numéro
                    </th>
                    <th scope="col" className={TH}>
                      Sens
                    </th>
                    <th scope="col" className={TH}>
                      Contrepartie
                    </th>
                    <th scope="col" className={TH}>
                      Article
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Quantité
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {location.moves.map((move) => {
                    const incoming = move.direction === "in";
                    const Icon = incoming ? ArrowDownToLine : ArrowUpFromLine;
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
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${
                              incoming
                                ? "border-brand/15 bg-brand-soft text-brand-strong"
                                : "border-copper/15 bg-copper-soft text-copper"
                            }`}
                          >
                            <Icon className="size-3" aria-hidden="true" />
                            {incoming ? "Entrée" : "Sortie"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                          {move.counterpartCode}
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
