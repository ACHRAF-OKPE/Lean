import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { PARTNER_TYPE_LABELS } from "@/modules/catalog/constants";
import { listPartners } from "@/modules/catalog/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Tiers",
};

const TH = "px-4 py-2.5 font-normal";

export default function PartnersPage({ searchParams }: PageProps<"/tiers">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des tiers…" />}>
      <PartnersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PartnersContent({ searchParams }: Pick<PageProps<"/tiers">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [page, memberships, params] = await Promise.all([
    listPartners(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const created = typeof params.cree === "string" ? params.cree : null;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Tiers</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Clients et fournisseurs de l&apos;espace actif. Les codes sont uniques et les mises à
              jour passent par un import analysé ligne à ligne.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {page.total} au total
            </span>
            <CatalogActions kind="partners" />
          </div>
        </div>

        {created ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Tiers <span className="font-mono">{created}</span> créé.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {page.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun tiers dans cet espace. Créez une fiche ou importez votre fichier XLSX avec le
              modèle téléchargeable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Tiers de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Nom
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Rôles
                    </th>
                    <th scope="col" className={TH}>
                      Localisation
                    </th>
                    <th scope="col" className={TH}>
                      Délai
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
                      <td className="px-4 py-2.5 font-medium">
                        <Link
                          href={`/tiers/${row.id}`}
                          className="transition-colors hover:text-brand"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {PARTNER_TYPE_LABELS[row.type]}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {row.isCustomer ? (
                            <span className="rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 text-[10px] text-brand-strong">
                              Client
                            </span>
                          ) : null}
                          {row.isSupplier ? (
                            <span className="rounded-full border border-copper/15 bg-copper-soft px-2 py-0.5 text-[10px] text-copper">
                              Fournisseur
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {[row.city, row.countryCode].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {row.paymentTermDays} j
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
            Affichage des {page.rows.length} premiers tiers sur {page.total}, classés par nom.
          </p>
        ) : null}
      </main>
    </div>
  );
}
