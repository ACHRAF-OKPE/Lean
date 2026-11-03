import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { HsCodeFilterBar } from "@/components/views/hs-code-filter-bar";
import { HsCodeListView } from "@/components/views/hs-code-list-view";
import { HsCodeTreeView } from "@/components/views/hs-code-tree-view";
import { HsCodeViewSwitcher } from "@/components/views/hs-code-view-switcher";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import {
  hasActiveHsCodeFilters,
  parseHsCodeFilters,
  type HsCodeFilters,
} from "@/modules/catalog/hs-code-filters";
import { listHsCodes } from "@/modules/catalog/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Nomenclature douanière",
};

function bannerLines(query: Record<string, string | string[] | undefined>): readonly string[] {
  const lines: string[] = [];
  if (typeof query.cree === "string") {
    lines.push(`Code SH ${query.cree} créé.`);
  }
  if (query.supprime === "ok") {
    lines.push("Code SH supprimé de l'espace.");
  }
  return lines;
}

export default function HsCodesPage({ searchParams }: PageProps<"/nomenclature">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la nomenclature…" />}>
      <HsCodesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function HsCodesContent({ searchParams }: Pick<PageProps<"/nomenclature">, "searchParams">) {
  await connection();
  const session = await requireModule("nomenclature", "read");
  const query = await searchParams;
  const filters: HsCodeFilters = parseHsCodeFilters(query);

  const db = getDb();
  const [page, memberships] = await Promise.all([
    listHsCodes(db, session.tenantId, filters),
    listMembershipsForUser(db, session.userId),
  ]);

  const lines = bannerLines(query);
  const filtered = hasActiveHsCodeFilters(filters);

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
              Codes SH à 6, 8 ou 10 chiffres, propres à l&apos;espace actif. Un code se crée à la
              volée depuis les articles et les déclarations : les parents manquants suivent
              automatiquement.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {page.total} {filtered ? "filtrés" : "au total"}
            </span>
            <HsCodeViewSwitcher filters={filters} />
            <CatalogActions kind="hs_codes" />
          </div>
        </div>

        {lines.length > 0 ? (
          <div className="mt-5 space-y-2">
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
          <HsCodeFilterBar filters={filters} />
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {page.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun code SH {filtered ? "ne correspond aux filtres" : "dans cet espace"}. Importez
              votre nomenclature avec le modèle téléchargeable, ou créez un code manuellement.
            </p>
          ) : filters.view === "arbre" ? (
            <HsCodeTreeView rows={page.rows} />
          ) : (
            <HsCodeListView rows={page.rows} />
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
