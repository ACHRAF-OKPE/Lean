import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Warehouse } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { StockLocationForm, StockLocationToggleButton } from "@/components/stock-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listStockLocations } from "@/modules/stock/locations";
import { formatQuantity } from "@/modules/stock/quantities";

export const metadata: Metadata = {
  title: "Magasins",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function StockLocationsPage(props: PageProps<"/stock/magasins">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des magasins…" />}>
      <StockLocationsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function StockLocationsContent({
  searchParams,
}: Pick<PageProps<"/stock/magasins">, "searchParams">) {
  await connection();
  const session = await requireModule("stock", "read");
  const query = await searchParams;
  const db = getDb();
  const [locations, memberships, levels] = await Promise.all([
    listStockLocations(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canManage = atLeast(levels.stock, "manage");
  const updated = query.maj !== undefined;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Magasins</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Seuls les magasins internes portent du stock disponible. Le code reste immuable une fois
          le magasin créé ; un magasin qui porte encore du stock, sert de magasin par défaut ou
          reste le dernier actif ne se désactive pas.
        </p>

        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Magasin mis à jour.
          </p>
        ) : null}

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Warehouse className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Nouveau magasin</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Un magasin naît actif. Le code s&apos;écrit en majuscules, lettres, chiffres et
              tirets.
            </p>
            <StockLocationForm />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Registre des magasins</h2>
            <p className="text-[10px] text-muted">
              {locations.length} {locations.length > 1 ? "magasins" : "magasin"}
            </p>
          </div>
          {locations.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun magasin interne. Le magasin principal est créé automatiquement à la première
              réception.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Magasins internes de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Nom
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Articles
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Quantité
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Mouvements
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => (
                    <tr key={location.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {location.code}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{location.name}</span>
                        <span className="block text-[10px] text-muted">
                          Créé le {isoDateLabel(location.createdAt.toISOString().slice(0, 10))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {location.articleCount}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(location.totalQuantity)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {location.moveCount}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${
                            location.active
                              ? "border-brand/15 bg-brand-soft text-brand-strong"
                              : "border-line bg-canvas text-muted"
                          }`}
                        >
                          {location.active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/stock/magasins/${location.id}`}
                            aria-label={`Ouvrir le magasin ${location.code}`}
                            title="Ouvrir la fiche"
                            className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                          {canManage ? (
                            <StockLocationToggleButton
                              locationId={location.id}
                              code={location.code}
                              active={location.active}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
