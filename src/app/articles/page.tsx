import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { ARTICLE_TYPE_LABELS, unitLabel } from "@/modules/catalog/constants";
import { listArticles } from "@/modules/catalog/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Articles",
};

const TH = "px-4 py-2.5 font-normal";

export default function ArticlesPage({ searchParams }: PageProps<"/articles">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des articles…" />}>
      <ArticlesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ArticlesContent({ searchParams }: Pick<PageProps<"/articles">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [page, memberships, params] = await Promise.all([
    listArticles(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const created = typeof params.cree === "string" ? params.cree : null;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="articles" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Articles</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Produits et services. Un produit porte un code SH de la nomenclature ; un service
              n&apos;en porte jamais. Les prix sont des montants XOF entiers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {page.total} au total
            </span>
            <CatalogActions kind="articles" />
          </div>
        </div>

        {created ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Article <span className="font-mono">{created}</span> créé.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {page.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun article dans cet espace. Créez une fiche ou importez votre fichier XLSX avec le
              modèle téléchargeable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Articles de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Désignation
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Unité
                    </th>
                    <th scope="col" className={TH}>
                      Code SH
                    </th>
                    <th scope="col" className={TH}>
                      Vente
                    </th>
                    <th scope="col" className={TH}>
                      Achat
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {row.code}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {ARTICLE_TYPE_LABELS[row.type]}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {unitLabel(row.unitCode)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {row.hsCode ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(row.salePriceXof)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(row.purchasePriceXof)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            row.active
                              ? "border-line bg-canvas text-muted"
                              : "border-copper/15 bg-copper-soft text-copper"
                          }`}
                        >
                          {row.active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {page.total > page.rows.length ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des {page.rows.length} premiers articles sur {page.total}, classés par
            désignation.
          </p>
        ) : null}
      </main>
    </div>
  );
}
