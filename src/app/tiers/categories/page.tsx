import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { CategoryManager } from "@/components/views/category-manager";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listPartnerCategories } from "@/modules/catalog/partner-queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Catégories de tiers",
};

const BANNERS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "cree", label: "Catégorie créée." },
  { key: "maj", label: "Catégorie mise à jour." },
  { key: "supprime", label: "Catégorie supprimée." },
];

export default function PartnerCategoriesPage({ searchParams }: PageProps<"/tiers/categories">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des catégories…" />}>
      <PartnerCategoriesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PartnerCategoriesContent({
  searchParams,
}: Pick<PageProps<"/tiers/categories">, "searchParams">) {
  await connection();
  const session = await requireModule("partners", "manage");
  const query = await searchParams;
  const db = getDb();
  const [categories, memberships] = await Promise.all([
    listPartnerCategories(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const lines = BANNERS.filter((banner) => query[banner.key] !== undefined).map(
    (banner) => banner.label,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/tiers"
            aria-label="Revenir aux tiers"
            title="Revenir aux tiers"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Paramétrage
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Catégories de tiers</h1>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-muted">
          Une catégorie regroupe des tiers dans une colonne de Kanban et se pose en filtre du
          registre. Renommer ou supprimer relève du paramétrage du module ; une catégorie désactivée
          reste sur les tiers qui la portent mais n&apos;est plus proposée à la saisie.
        </p>

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

        <CategoryManager categories={categories} />
      </main>
    </div>
  );
}
