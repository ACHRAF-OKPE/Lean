import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Tags } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { PartnerFilterBar } from "@/components/views/partner-filter-bar";
import { PartnerKanbanView } from "@/components/views/partner-kanban-view";
import { PartnerListView } from "@/components/views/partner-list-view";
import { PartnerMapView } from "@/components/views/partner-map-view";
import { ViewSwitcher } from "@/components/views/view-switcher";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import {
  hasActivePartnerFilters,
  parsePartnerFilters,
  partnerFiltersQuery,
  type PartnerFilters,
} from "@/modules/catalog/filters";
import { categoriesByPartner, listPartnerCategories } from "@/modules/catalog/partner-queries";
import { listPartners } from "@/modules/catalog/queries";
import { atLeast, type RequiredLevel } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Tiers",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function bannerLines(query: Record<string, string | string[] | undefined>): readonly string[] {
  const lines: string[] = [];
  const created = typeof query.cree === "string" ? query.cree : null;
  if (created) {
    lines.push(`Tiers ${created} créé.`);
  }
  if (query.lot === "ok") {
    lines.push("Action appliquée à la sélection ; chaque ligne modifiée est auditée.");
  }
  if (query.supprime === "ok") {
    lines.push("Tiers supprimé de l'espace.");
  }
  return lines;
}

export default function PartnersPage({ searchParams }: PageProps<"/tiers">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des tiers…" />}>
      <PartnersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PartnersContent({ searchParams }: Pick<PageProps<"/tiers">, "searchParams">) {
  await connection();
  const session = await requireModule("partners", "read");
  const query = await searchParams;
  const filters: PartnerFilters = parsePartnerFilters(query);

  const db = getDb();
  const [page, categories, levels, memberships] = await Promise.all([
    listPartners(db, session.tenantId, filters),
    listPartnerCategories(db, session.tenantId),
    getAccessLevels(session),
    listMembershipsForUser(db, session.userId),
  ]);

  const held = levels.partners;
  // La page est déjà ouverte en lecture : le niveau effectif y est au moins `read`.
  const level: RequiredLevel = held === "none" ? "read" : held;
  const categoryTitles = await categoriesByPartner(
    db,
    session.tenantId,
    page.rows.map((row) => row.id),
  );

  const lines = bannerLines(query);
  const filtered = hasActivePartnerFilters(filters);

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
              Clients et fournisseurs de l&apos;espace actif. Les codes sont uniques ; les filtres
              et la vue choisie restent dans l&apos;adresse et se partagent tels quels.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {page.total} {filtered ? "filtrés" : "au total"}
            </span>
            <ViewSwitcher filters={filters} />
            {atLeast(level, "manage") ? (
              <Link
                href="/tiers/categories"
                aria-label="Catégories de tiers"
                title="Catégories de tiers"
                className={ACTION_LINK}
              >
                <Tags className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
            <CatalogActions kind="partners" />
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

        <div className="mt-5 space-y-4">
          <PartnerFilterBar filters={filters} categories={categories} />

          {page.rows.length === 0 ? (
            <div className="rounded-xl border border-line bg-panel px-5 py-10 text-center text-[11px] leading-5 text-muted">
              {filtered
                ? "Aucun tiers ne correspond à ces filtres. Élargissez la recherche ou effacez les filtres."
                : "Aucun tiers dans cet espace. Créez une fiche ou importez votre fichier XLSX avec le modèle téléchargeable."}
            </div>
          ) : filters.view === "kanban" ? (
            <PartnerKanbanView rows={page.rows} categoriesByPartner={categoryTitles} />
          ) : filters.view === "carte" ? (
            <PartnerMapView rows={page.rows} />
          ) : (
            <PartnerListView
              filters={filters}
              rows={page.rows}
              categoryTitles={Object.fromEntries(categoryTitles)}
              categories={categories}
              level={level}
              retour={partnerFiltersQuery(filters)}
            />
          )}

          {page.rows.length === 0 ? null : (
            <p className="text-[10px] text-muted">
              {page.rows.length} ligne{page.rows.length > 1 ? "s" : ""} sur {page.total} du jeu
              filtré, dans la limite de {page.limit}, classées par nom.
              {filters.view === "carte"
                ? " La carte ne montre que les tiers munis de leurs deux coordonnées."
                : null}
              {filters.view === "kanban"
                ? " Le Kanban regroupe par catégorie ; les tiers sans catégorie forment « Sans catégorie »."
                : null}
            </p>
          )}
        </div>

        {categories.length === 0 && atLeast(level, "manage") ? (
          <p className="mt-6 text-[10px] leading-4 text-muted">
            Aucune catégorie n&apos;est définie :{" "}
            <Link href="/tiers/categories" className="underline">
              créez-les
            </Link>{" "}
            pour regrouper le Kanban et filtrer le registre.
          </p>
        ) : null}
      </main>
    </div>
  );
}
