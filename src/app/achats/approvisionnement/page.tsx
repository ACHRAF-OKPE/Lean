import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeftRight, ClipboardList, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listSupplyPolicies } from "@/modules/supply/queries";
import { formatQuantity } from "@/modules/stock/quantities";
import { PolicyEditor } from "./policy-editor";

export const metadata: Metadata = {
  title: "Politiques d'approvisionnement",
};

const TH = "px-4 py-2.5 font-normal";
const TIMESTAMP = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function SupplyPoliciesPage(props: PageProps<"/achats/approvisionnement">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des politiques d'approvisionnement…" />}>
      <SupplyPoliciesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SupplyPoliciesContent({
  searchParams,
}: Pick<PageProps<"/achats/approvisionnement">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const query = await searchParams;
  const db = getDb();
  const [page, memberships] = await Promise.all([
    listSupplyPolicies(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const canWrite = can(session.role, "data.write");
  const followed = page.rows.filter((row) => row.supplierId);
  const active = followed.filter((row) => row.active);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="supply" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Achats</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">
              Politiques d&apos;approvisionnement
            </h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Par article approvisionnable : fournisseur par défaut, délais, stock minimum, quantité
              de réapprovisionnement et multiple de commande. Le calcul des besoins s&apos;appuie
              sur ces paramètres et sur le stock, les commandes fournisseurs confirmées et les
              commandes clients confirmées.
            </p>
          </div>
          <Link
            href="/achats/besoins"
            aria-label="Ouvrir les calculs des besoins"
            title="Calculs des besoins"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ClipboardList className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {typeof query.maj === "string" ? (
          <p
            role="status"
            className="mt-5 flex gap-2 rounded-md border border-brand/20 bg-brand-soft px-3 py-2.5 text-[11px] leading-5 text-brand-strong"
          >
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Politique enregistrée. Elle s&apos;applique au prochain calcul des besoins.</span>
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Articles suivis</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{followed.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Politiques actives</dt>
            <dd className="mt-1 font-mono text-2xl text-brand tabular-nums">{active.length}</dd>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <ArrowLeftRight className="size-4 text-brand" aria-hidden="true" />
            <p className="text-[10px] leading-4 text-muted">
              {page.rows.length} article{page.rows.length > 1 ? "s" : ""} produit
              {page.rows.length > 1 ? "s" : ""} achetable{page.rows.length > 1 ? "s" : ""} dans cet
              espace.
            </p>
          </div>
        </dl>

        {canWrite && page.rows.length > 0 && page.suppliers.length > 0 ? (
          <div className="mt-5">
            <PolicyEditor rows={page.rows} suppliers={page.suppliers} />
          </div>
        ) : null}

        {page.rows.length === 0 ? (
          <p className="mt-5 rounded-xl border border-line bg-panel px-5 py-10 text-center text-[11px] leading-5 text-muted">
            Aucun article produit achetable. Activez le caractère achetable d&apos;un article dans
            le catalogue pour pouvoir le suivre.
          </p>
        ) : null}

        {page.suppliers.length === 0 && page.rows.length > 0 ? (
          <p className="mt-5 rounded-xl border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            Aucun fournisseur actif : créez un tiers fournisseur avant de définir une politique.
          </p>
        ) : null}

        {followed.length > 0 ? (
          <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Politiques d&apos;approvisionnement de l&apos;espace actif
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Article
                    </th>
                    <th scope="col" className={TH}>
                      Fournisseur
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Délais
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Stock min.
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Réappro.
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Multiple
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Prix d&apos;achat
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Mise à jour
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {followed.map((row) => (
                    <tr key={row.articleId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-mono text-[10px] text-muted">
                          {row.articleCode}
                        </span>
                        <span className="block max-w-64 truncate font-medium">
                          {row.articleName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{row.supplierName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.leadTimeDays} j + {row.safetyDelayDays} j
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatQuantity(row.minStockQty)} {row.unitCode}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatQuantity(row.reorderQty)} {row.unitCode}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.orderMultipleQty ? formatQuantity(row.orderMultipleQty) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatXof(row.purchasePriceXof)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            row.active
                              ? "border-brand/20 bg-brand-soft text-brand-strong"
                              : "border-line bg-canvas text-muted"
                          }`}
                        >
                          {row.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted tabular-nums">
                        {row.updatedAt ? TIMESTAMP.format(row.updatedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {page.rows.length === 500 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 500 premiers articles approvisionnables.
          </p>
        ) : null}
      </main>
    </div>
  );
}
