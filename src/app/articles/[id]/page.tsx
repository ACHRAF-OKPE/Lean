import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Pencil } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { ArticleDeleteButton } from "@/components/views/article-delete-button";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { categoriesByArticle } from "@/modules/catalog/article-queries";
import { ARTICLE_TYPE_LABELS, unitLabel } from "@/modules/catalog/constants";
import { getArticle } from "@/modules/catalog/queries";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Fiche article",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bannerFor(query: Record<string, string | string[] | undefined>): string | null {
  if (query.maj === "ok") {
    return "Fiche mise à jour ; le changement est audité.";
  }
  return null;
}

export default function ArticlePage(props: PageProps<"/articles/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de l'article…" />}>
      <ArticleContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ArticleContent({
  params,
  searchParams,
}: Pick<PageProps<"/articles/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("articles", "read");
  const { id: articleId } = await params;
  if (!UUID_PATTERN.test(articleId)) {
    notFound();
  }

  const db = getDb();
  const [article, memberships, levels, query] = await Promise.all([
    getArticle(db, { tenantId: session.tenantId, articleId }),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    searchParams,
  ]);

  if (!article) {
    notFound();
  }

  const categories = (await categoriesByArticle(db, session.tenantId, [article.id])).get(
    article.id,
  );
  const level = levels.articles;
  const canWrite = atLeast(level, "write");
  const canManage = atLeast(level, "manage");
  const banner = bannerFor(query);
  const usage = [article.isSellable ? "Vendable" : null, article.isPurchasable ? "Achetable" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="articles" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <Link
          href="/articles"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Tous les articles
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              {article.code}
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">{article.name}</h1>
            <p className="mt-1 text-[11px] text-muted">
              {ARTICLE_TYPE_LABELS[article.type]} · {unitLabel(article.unitCode)} · {usage}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] ${
                article.active
                  ? "border-brand/15 bg-brand-soft text-brand-strong"
                  : "border-copper/15 bg-copper-soft text-copper"
              }`}
            >
              {article.active ? "Actif" : "Inactif"}
            </span>
            {canWrite ? (
              <Link
                href={`/articles/${article.id}/modifier`}
                aria-label="Modifier l'article"
                title="Modifier l'article"
                className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
            {canManage ? (
              <ArticleDeleteButton
                articleId={article.id}
                articleName={article.name}
                retour="/articles"
              />
            ) : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            {banner}
          </p>
        ) : null}

        <section
          aria-label="Informations de l'article"
          className="mt-6 grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Type</p>
            <p className="mt-1 text-[11px]">{ARTICLE_TYPE_LABELS[article.type]}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Unité</p>
            <p className="mt-1 text-[11px]">{unitLabel(article.unitCode)}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Code SH</p>
            <p className="mt-1 font-mono text-[11px]">{article.hsCode ?? "—"}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Prix de vente
            </p>
            <p className="mt-1 text-[11px] tabular-nums">{formatXof(article.salePriceXof)}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Prix d&apos;achat
            </p>
            <p className="mt-1 text-[11px] tabular-nums">{formatXof(article.purchasePriceXof)}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Pays d&apos;origine
            </p>
            <p className="mt-1 font-mono text-[11px]">{article.countryOfOrigin ?? "—"}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Usage</p>
            <p className="mt-1 text-[11px]">{usage}</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Catégories
            </p>
            {categories && categories.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {categories.map((category) => (
                  <span
                    key={category.id}
                    className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-muted"
                  >
                    {category.title}
                  </span>
                ))}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted">—</p>
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Description
            </p>
            <p className="mt-1 text-[11px] leading-5 whitespace-pre-line">
              {article.description ?? "—"}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
