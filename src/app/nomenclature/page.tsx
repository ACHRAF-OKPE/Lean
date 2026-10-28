import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listHsCodes } from "@/modules/catalog/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Nomenclature douanière",
};

const TH = "px-4 py-2.5 font-normal";

export default function HsCodesPage({ searchParams }: PageProps<"/nomenclature">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la nomenclature…" />}>
      <HsCodesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function HsCodesContent({ searchParams }: Pick<PageProps<"/nomenclature">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [page, memberships, params] = await Promise.all([
    listHsCodes(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const created = typeof params.cree === "string" ? params.cree : null;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="nomenclature" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Nomenclature douanière</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Codes SH à 6, 8 ou 10 chiffres, propres à l&apos;espace actif. Importez les parents
              avant les enfants, ou les deux dans le même fichier.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {page.total} au total
            </span>
            <CatalogActions kind="hs_codes" />
          </div>
        </div>

        {created ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Code SH <span className="font-mono">{created}</span> créé.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {page.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun code SH dans cet espace. Importez votre nomenclature avec le modèle
              téléchargeable, ou créez un code manuellement.
            </p>
          ) : (
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
                      Parent
                    </th>
                    <th scope="col" className={TH}>
                      Unité complémentaire
                    </th>
                    <th scope="col" className={TH}>
                      TEC
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {row.code}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{row.wording}</td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                        {row.parentCode ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {row.supplementaryUnit ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {row.tecRate === null ? "—" : `${row.tecRate} %`}
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
            Affichage des {page.rows.length} premiers codes sur {page.total}, classés par code.
          </p>
        ) : null}
      </main>
    </div>
  );
}
