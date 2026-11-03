import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { categoriesByArticle, listArticleCategories } from "@/modules/catalog/article-queries";
import { getArticle, listHsCodeOptions } from "@/modules/catalog/queries";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ArticleEditForm } from "./article-edit-form";

export const metadata: Metadata = {
  title: "Modifier un article",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ArticleEditPage(props: PageProps<"/articles/[id]/modifier">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <ArticleEditContent params={props.params} />
    </Suspense>
  );
}

async function ArticleEditContent({
  params,
}: Pick<PageProps<"/articles/[id]/modifier">, "params">) {
  await connection();
  const session = await requireModule("articles", "write");
  const { id: articleId } = await params;
  if (!UUID_PATTERN.test(articleId)) {
    notFound();
  }

  const db = getDb();
  const [article, categories, titles, memberships, levels, hsCodes] = await Promise.all([
    getArticle(db, { tenantId: session.tenantId, articleId }),
    listArticleCategories(db, session.tenantId),
    categoriesByArticle(db, session.tenantId, [articleId]),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    listHsCodeOptions(db, session.tenantId),
  ]);

  if (!article) {
    notFound();
  }

  const selected = (titles.get(article.id) ?? []).map((category) => category.id);
  const options = categories
    .filter((category) => category.active || selected.includes(category.id))
    .map((category) => ({ id: category.id, label: category.title }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="articles" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href={`/articles/${article.id}`}
            aria-label="Revenir à la fiche"
            title="Revenir à la fiche"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              {article.code}
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Modifier l&apos;article</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Chaque modification remplace la valeur précédente et laisse une trace d&apos;audit. Le
          code de la fiche reste immuable.
        </p>

        <ArticleEditForm
          article={{
            id: article.id,
            code: article.code,
            name: article.name,
            description: article.description,
            type: article.type,
            unitCode: article.unitCode,
            hsCode: article.hsCode,
            salePriceXof: article.salePriceXof,
            purchasePriceXof: article.purchasePriceXof,
            isSellable: article.isSellable,
            isPurchasable: article.isPurchasable,
            countryOfOrigin: article.countryOfOrigin,
            active: article.active,
          }}
          categories={options}
          selected={selected}
          canCreateCategories={atLeast(levels.articles, "manage")}
          hsCodes={hsCodes}
          canCreateHsCode={atLeast(levels.nomenclature, "write")}
        />
      </main>
    </div>
  );
}
