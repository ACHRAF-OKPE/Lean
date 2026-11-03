import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { ArticleCategoryManager } from "@/components/views/article-category-manager";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listArticleCategories } from "@/modules/catalog/article-queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Catégories d'articles",
};

const BANNERS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "cree", label: "Catégorie créée." },
  { key: "maj", label: "Catégorie mise à jour." },
  { key: "supprime", label: "Catégorie supprimée." },
];

export default function ArticleCategoriesPage({ searchParams }: PageProps<"/articles/categories">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des catégories…" />}>
      <ArticleCategoriesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ArticleCategoriesContent({
  searchParams,
}: Pick<PageProps<"/articles/categories">, "searchParams">) {
  await connection();
  const session = await requireModule("articles", "manage");
  const query = await searchParams;
  const db = getDb();
  const [categories, memberships] = await Promise.all([
    listArticleCategories(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const lines = BANNERS.filter((banner) => query[banner.key] !== undefined).map(
    (banner) => banner.label,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="articles" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/articles"
            aria-label="Revenir aux articles"
            title="Revenir aux articles"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Paramétrage
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Catégories d&apos;articles</h1>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-muted">
          Une catégorie regroupe des articles dans une colonne de Kanban et se pose en filtre du
          registre. Renommer ou supprimer relève du paramétrage du module ; une catégorie désactivée
          reste sur les articles qui la portent mais n&apos;est plus proposée à la saisie.
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

        <ArticleCategoryManager categories={categories} />
      </main>
    </div>
  );
}
