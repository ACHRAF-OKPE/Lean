import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { parseArticleFilters } from "@/modules/catalog/article-filters";
import { categoriesByArticle } from "@/modules/catalog/article-queries";
import { listArticles } from "@/modules/catalog/queries";
import { articlesExportFileName, buildArticlesExport } from "@/modules/catalog/xlsx";

function rawParams(url: URL): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }
  return raw;
}

/** GEN-017 — l'export reprend le jeu filtré, ou seulement la sélection qui lui est ajoutée. */
export async function GET(request: Request): Promise<Response> {
  const session = await requireModule("articles", "read");
  const filters = parseArticleFilters(rawParams(new URL(request.url)));

  const db = getDb();
  const page = await listArticles(db, session.tenantId, filters);
  const categories = await categoriesByArticle(
    db,
    session.tenantId,
    page.rows.map((row) => row.id),
  );

  const bytes = await buildArticlesExport(
    page.rows.map((row) => ({
      code: row.code,
      name: row.name,
      type: row.type,
      unitCode: row.unitCode,
      hsCode: row.hsCode,
      salePriceXof: row.salePriceXof,
      purchasePriceXof: row.purchasePriceXof,
      isSellable: row.isSellable,
      isPurchasable: row.isPurchasable,
      countryOfOrigin: null,
      active: row.active,
      categories: (categories.get(row.id) ?? []).map((category) => category.title),
    })),
  );

  return new Response(new Blob([bytes]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${articlesExportFileName()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
