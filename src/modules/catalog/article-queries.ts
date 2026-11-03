import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { type Database } from "@/db/client";
import {
  articleCategories,
  articleCategoryLinks,
  articleSupplyPolicies,
  articles,
  auditEvents,
  deliveryLines,
  hsCodes,
  invoiceLines,
  purchaseOrderLines,
  salesOrderLines,
  stockLevels,
  stockMoveLines,
  supplyRunLines,
  tenderRequestLines,
} from "@/db/schema";
import { planArticleBulk } from "./article-bulk";
import type { ArticleEditData } from "./article-edit";
import { categoryTitleErrors, normalizeCategoryTitle, planCategoryDelete } from "./categories";
import { CatalogError } from "./errors";
import { isUniqueViolation } from "./partner-queries";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ArticleCategory {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly articleCount: number;
}

const CATEGORY_COUNTS = sql<number>`count(${articleCategoryLinks.id})::int`;

/** ART-012 — les catégories d'articles de l'espace, avec le volume d'articles qu'elles portent. */
export async function listArticleCategories(
  db: Database,
  tenantId: string,
): Promise<ArticleCategory[]> {
  const rows = await db
    .select({
      id: articleCategories.id,
      title: articleCategories.title,
      active: articleCategories.active,
      articleCount: CATEGORY_COUNTS,
    })
    .from(articleCategories)
    .leftJoin(
      articleCategoryLinks,
      and(
        eq(articleCategoryLinks.tenantId, articleCategories.tenantId),
        eq(articleCategoryLinks.categoryId, articleCategories.id),
      ),
    )
    .where(eq(articleCategories.tenantId, tenantId))
    .groupBy(articleCategories.id)
    .orderBy(asc(articleCategories.title));

  return rows.map((row) => ({ ...row, articleCount: Number(row.articleCount) }));
}

export async function createArticleCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; title: string },
): Promise<ArticleCategory> {
  const title = normalizeCategoryTitle(input.title);
  const errors = categoryTitleErrors(title);
  if (errors.length > 0) {
    throw new CatalogError(errors[0]!);
  }

  try {
    const [created] = await db
      .insert(articleCategories)
      .values({ tenantId: input.tenantId, title })
      .returning({ id: articleCategories.id, title: articleCategories.title });

    if (!created) {
      throw new CatalogError("La catégorie n'a pas pu être créée.");
    }

    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article_category.create",
      entityType: "article_category",
      entityId: created.id,
      details: { title: created.title },
    });

    return { id: created.id, title: created.title, active: true, articleCount: 0 };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CatalogError(`La catégorie « ${title} » existe déjà dans cet espace.`);
    }
    throw error;
  }
}

/** GEN-015 — le titre tapé dans le champ de référence : on retrouve la catégorie existante ou on la crée. */
export async function resolveArticleCategoryIds(
  db: Database,
  input: { tenantId: string; actorUserId: string; titles: readonly string[] },
): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of input.titles) {
    const title = normalizeCategoryTitle(raw);
    if (title === "") {
      continue;
    }
    const [existing] = await db
      .select({ id: articleCategories.id })
      .from(articleCategories)
      .where(
        and(
          eq(articleCategories.tenantId, input.tenantId),
          sql`lower(${articleCategories.title}) = lower(${title})`,
        ),
      )
      .limit(1);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await createArticleCategory(db, { ...input, title });
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

export async function renameArticleCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string; title: string },
): Promise<void> {
  const title = normalizeCategoryTitle(input.title);
  const errors = categoryTitleErrors(title);
  if (errors.length > 0) {
    throw new CatalogError(errors[0]!);
  }

  await db.transaction(async (tx) => {
    const before = await lockArticleCategory(tx, input.tenantId, input.categoryId);
    await tx
      .update(articleCategories)
      .set({ title, updatedAt: new Date() })
      .where(
        and(eq(articleCategories.tenantId, input.tenantId), eq(articleCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article_category.update",
      entityType: "article_category",
      entityId: before.id,
      details: { before: { title: before.title }, after: { title } },
    });
  });
}

/** ART-012 — activer ou désactiver une catégorie ; la désactivation se trace comme une modification. */
export async function setArticleCategoryActive(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string; active: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockArticleCategory(tx, input.tenantId, input.categoryId);
    await tx
      .update(articleCategories)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(articleCategories.tenantId, input.tenantId), eq(articleCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article_category.update",
      entityType: "article_category",
      entityId: before.id,
      details: { code: before.title, before: before.active, after: input.active },
    });
  });
}

/** ART-012 — une catégorie portée ne se supprime pas : le refus est écrit avant toute écriture. */
export async function deleteArticleCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockArticleCategory(tx, input.tenantId, input.categoryId);
    const [counted] = await tx
      .select({ value: count() })
      .from(articleCategoryLinks)
      .where(
        and(
          eq(articleCategoryLinks.tenantId, input.tenantId),
          eq(articleCategoryLinks.categoryId, before.id),
        ),
      );

    const plan = planCategoryDelete({
      title: before.title,
      count: counted?.value ?? 0,
      subject: "article(s)",
    });
    if (!plan.ok) {
      throw new CatalogError(plan.error);
    }

    await tx
      .delete(articleCategories)
      .where(
        and(eq(articleCategories.tenantId, input.tenantId), eq(articleCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article_category.delete",
      entityType: "article_category",
      entityId: before.id,
      details: { before: { title: before.title }, after: null },
    });
  });
}

/** Les catégories portées par une page d'articles, pour la liste, le Kanban et la fiche. */
export async function categoriesByArticle(
  db: Database,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, { id: string; title: string }[]>> {
  const map = new Map<string, { id: string; title: string }[]>();
  if (articleIds.length === 0) {
    return map;
  }

  const rows = await db
    .select({
      articleId: articleCategoryLinks.articleId,
      id: articleCategories.id,
      title: articleCategories.title,
    })
    .from(articleCategoryLinks)
    .innerJoin(
      articleCategories,
      and(
        eq(articleCategories.tenantId, articleCategoryLinks.tenantId),
        eq(articleCategories.id, articleCategoryLinks.categoryId),
      ),
    )
    .where(
      and(
        eq(articleCategoryLinks.tenantId, tenantId),
        inArray(articleCategoryLinks.articleId, [...articleIds]),
      ),
    )
    .orderBy(asc(articleCategories.title));

  for (const row of rows) {
    const list = map.get(row.articleId) ?? [];
    list.push({ id: row.id, title: row.title });
    map.set(row.articleId, list);
  }
  return map;
}

/** Les identifiants des articles portant l'une des catégories demandées. */
export async function articleIdsByCategories(
  db: Database,
  tenantId: string,
  categoryIds: readonly string[],
): Promise<string[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ articleId: articleCategoryLinks.articleId })
    .from(articleCategoryLinks)
    .where(
      and(
        eq(articleCategoryLinks.tenantId, tenantId),
        inArray(articleCategoryLinks.categoryId, [...categoryIds]),
      ),
    );
  return [...new Set(rows.map((row) => row.articleId))];
}

/** ART-012 — le rattachement se remplace en bloc : la fiche garde exactement les catégories choisies. */
export async function replaceArticleCategories(
  tx: Transaction,
  input: { tenantId: string; articleId: string; categoryIds: readonly string[] },
): Promise<void> {
  await tx
    .delete(articleCategoryLinks)
    .where(
      and(
        eq(articleCategoryLinks.tenantId, input.tenantId),
        eq(articleCategoryLinks.articleId, input.articleId),
      ),
    );

  for (const categoryId of [...new Set(input.categoryIds)]) {
    const [known] = await tx
      .select({ id: articleCategories.id })
      .from(articleCategories)
      .where(
        and(eq(articleCategories.tenantId, input.tenantId), eq(articleCategories.id, categoryId)),
      )
      .limit(1);
    if (!known) {
      throw new CatalogError("Une catégorie rattachée à l'article est inconnue dans cet espace.");
    }
    await tx.insert(articleCategoryLinks).values({
      tenantId: input.tenantId,
      articleId: input.articleId,
      categoryId,
    });
  }
}

/**
 * ART-012 / GEN-017 — un article référencé par des documents ne se supprime pas : la liste des
 * documents qui le citent formule le refus, ligne par ligne.
 */
export async function articleDocumentReferences(
  db: Database,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const targets = [...new Set(articleIds)];
  const result = new Map<string, string[]>();
  if (targets.length === 0) {
    return result;
  }

  const sources: readonly {
    readonly label: string;
    readonly rows: () => Promise<{ articleId: string | null; value: number }[]>;
  }[] = [
    {
      label: "politiques d'approvisionnement",
      rows: () =>
        db
          .select({ articleId: articleSupplyPolicies.articleId, value: count() })
          .from(articleSupplyPolicies)
          .where(
            and(
              eq(articleSupplyPolicies.tenantId, tenantId),
              inArray(articleSupplyPolicies.articleId, targets),
            ),
          )
          .groupBy(articleSupplyPolicies.articleId),
    },
    {
      label: "lignes de besoins d'achat",
      rows: () =>
        db
          .select({ articleId: tenderRequestLines.articleId, value: count() })
          .from(tenderRequestLines)
          .where(
            and(
              eq(tenderRequestLines.tenantId, tenantId),
              inArray(tenderRequestLines.articleId, targets),
            ),
          )
          .groupBy(tenderRequestLines.articleId),
    },
    {
      label: "besoins d'achat",
      rows: () =>
        db
          .select({ articleId: supplyRunLines.articleId, value: count() })
          .from(supplyRunLines)
          .where(
            and(eq(supplyRunLines.tenantId, tenantId), inArray(supplyRunLines.articleId, targets)),
          )
          .groupBy(supplyRunLines.articleId),
    },
    {
      label: "lignes de commande fournisseur",
      rows: () =>
        db
          .select({ articleId: purchaseOrderLines.articleId, value: count() })
          .from(purchaseOrderLines)
          .where(
            and(
              eq(purchaseOrderLines.tenantId, tenantId),
              inArray(purchaseOrderLines.articleId, targets),
            ),
          )
          .groupBy(purchaseOrderLines.articleId),
    },
    {
      label: "lignes de commande client",
      rows: () =>
        db
          .select({ articleId: salesOrderLines.articleId, value: count() })
          .from(salesOrderLines)
          .where(
            and(
              eq(salesOrderLines.tenantId, tenantId),
              inArray(salesOrderLines.articleId, targets),
            ),
          )
          .groupBy(salesOrderLines.articleId),
    },
    {
      label: "lignes de livraison",
      rows: () =>
        db
          .select({ articleId: deliveryLines.articleId, value: count() })
          .from(deliveryLines)
          .where(
            and(eq(deliveryLines.tenantId, tenantId), inArray(deliveryLines.articleId, targets)),
          )
          .groupBy(deliveryLines.articleId),
    },
    {
      label: "lignes de facture",
      rows: () =>
        db
          .select({ articleId: invoiceLines.articleId, value: count() })
          .from(invoiceLines)
          .where(and(eq(invoiceLines.tenantId, tenantId), inArray(invoiceLines.articleId, targets)))
          .groupBy(invoiceLines.articleId),
    },
    {
      label: "lignes de mouvement de stock",
      rows: () =>
        db
          .select({ articleId: stockMoveLines.articleId, value: count() })
          .from(stockMoveLines)
          .where(
            and(eq(stockMoveLines.tenantId, tenantId), inArray(stockMoveLines.articleId, targets)),
          )
          .groupBy(stockMoveLines.articleId),
    },
    {
      label: "niveaux de stock",
      rows: () =>
        db
          .select({ articleId: stockLevels.articleId, value: count() })
          .from(stockLevels)
          .where(and(eq(stockLevels.tenantId, tenantId), inArray(stockLevels.articleId, targets)))
          .groupBy(stockLevels.articleId),
    },
  ];

  for (const source of sources) {
    for (const row of await source.rows()) {
      if (row.articleId === null || row.value === 0) {
        continue;
      }
      const list = result.get(row.articleId) ?? [];
      list.push(`${source.label} (${row.value})`);
      result.set(row.articleId, list);
    }
  }

  return result;
}

async function lockArticleCategory(
  tx: Transaction,
  tenantId: string,
  categoryId: string,
): Promise<{ id: string; title: string; active: boolean }> {
  const [row] = await tx
    .select({
      id: articleCategories.id,
      title: articleCategories.title,
      active: articleCategories.active,
    })
    .from(articleCategories)
    .where(and(eq(articleCategories.tenantId, tenantId), eq(articleCategories.id, categoryId)))
    .for("update")
    .limit(1);

  if (!row) {
    throw new CatalogError("Catégorie introuvable dans cet espace de travail.");
  }
  return row;
}

async function lockArticle(
  tx: Transaction,
  tenantId: string,
  articleId: string,
): Promise<{
  id: string;
  code: string;
  name: string;
  type: "product" | "service";
  active: boolean;
}> {
  const [row] = await tx
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      type: articles.type,
      active: articles.active,
    })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), eq(articles.id, articleId)))
    .for("update")
    .limit(1);

  if (!row) {
    throw new CatalogError("Article introuvable dans cet espace de travail.");
  }
  return row;
}

async function resolveHsCodeId(
  tx: Transaction,
  tenantId: string,
  data: ArticleEditData,
): Promise<string | null> {
  if (data.type !== "product") {
    return null;
  }
  if (!data.hsCode) {
    throw new CatalogError("Un produit exige un code SH.");
  }
  const [hsCode] = await tx
    .select({ id: hsCodes.id })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, tenantId), eq(hsCodes.code, data.hsCode)))
    .limit(1);
  if (!hsCode) {
    throw new CatalogError(
      `Le code SH ${data.hsCode} n'existe pas dans cet espace : créez-le depuis la nomenclature.`,
    );
  }
  return hsCode.id;
}

/** ART-015 — la fiche se corrige ligne à ligne ; catégories et code SH suivent les gardes de création. */
export async function updateArticle(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    articleId: string;
    data: ArticleEditData;
    categoryIds: readonly string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockArticle(tx, input.tenantId, input.articleId);
    const after = input.data;
    const hsCodeId = await resolveHsCodeId(tx, input.tenantId, after);

    await tx
      .update(articles)
      .set({
        name: after.name,
        description: after.description,
        type: after.type,
        unitCode: after.unitCode,
        hsCodeId,
        salePriceXof: after.salePriceXof,
        purchasePriceXof: after.purchasePriceXof,
        isSellable: after.isSellable,
        isPurchasable: after.isPurchasable,
        countryOfOrigin: after.countryOfOrigin,
        active: after.active,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, before.id)));

    await replaceArticleCategories(tx, {
      tenantId: input.tenantId,
      articleId: before.id,
      categoryIds: input.categoryIds,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article.update",
      entityType: "article",
      entityId: before.id,
      details: {
        code: before.code,
        before: { name: before.name, type: before.type, active: before.active },
        after: { name: after.name, type: after.type, active: after.active },
      },
    });
  });
}

/** GEN-017 — une sélection se supprime en une transaction, ou pas du tout. */
export async function deleteArticles(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    ids: readonly string[];
    level: "read" | "write" | "manage" | "none" | undefined;
  },
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    throw new CatalogError("Aucun article sélectionné.");
  }

  const [rows, references] = await Promise.all([
    db
      .select({ id: articles.id, code: articles.code, name: articles.name })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.id, ids))),
    articleDocumentReferences(db, input.tenantId, ids),
  ]);

  if (rows.length !== ids.length) {
    throw new CatalogError("Un article de la sélection est introuvable dans cet espace.");
  }

  const plan = planArticleBulk({
    action: "supprimer",
    level: input.level === "none" ? undefined : input.level,
    selectedIds: ids,
    lines: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      references: references.get(row.id) ?? [],
    })),
  });
  if (!plan.ok) {
    throw new CatalogError(plan.errors.join(" "));
  }

  await db.transaction(async (tx) => {
    for (const id of plan.ids) {
      const before = await lockArticle(tx, input.tenantId, id);
      await tx
        .delete(articles)
        .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, before.id)));
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.article.delete",
        entityType: "article",
        entityId: before.id,
        details: { code: before.code, before: { name: before.name }, after: null },
      });
    }
  });
}

/** GEN-017 — la suppression d'une fiche passe par le plan : un article cité ne part pas. */
export async function deleteArticle(
  db: Database,
  input: { tenantId: string; actorUserId: string; articleId: string },
): Promise<void> {
  const references = await articleDocumentReferences(db, input.tenantId, [input.articleId]);
  const cited = references.get(input.articleId) ?? [];
  if (cited.length > 0) {
    const [article] = await db
      .select({ code: articles.code, name: articles.name })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, input.articleId)))
      .limit(1);
    throw new CatalogError(
      `${article?.code ?? "?"} · ${article?.name ?? "?"} : rattaché à ${cited.join(", ")}, la suppression est refusée.`,
    );
  }

  await db.transaction(async (tx) => {
    const before = await lockArticle(tx, input.tenantId, input.articleId);
    await tx
      .delete(articles)
      .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article.delete",
      entityType: "article",
      entityId: before.id,
      details: { code: before.code, before: { name: before.name }, after: null },
    });
  });
}

export interface ArticleBulkPatch {
  readonly active?: boolean;
  readonly categoryIds?: readonly string[];
}

/** GEN-017 — une sélection, une transaction, un événement d'audit par ligne : rien n'est à moitié écrit. */
export async function applyArticleBulk(
  db: Database,
  input: { tenantId: string; actorUserId: string; ids: readonly string[]; patch: ArticleBulkPatch },
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    throw new CatalogError("Aucun article sélectionné.");
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: articles.id,
        code: articles.code,
        name: articles.name,
        active: articles.active,
      })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.id, ids)))
      .for("update");

    if (rows.length !== ids.length) {
      throw new CatalogError("Un article de la sélection est introuvable dans cet espace.");
    }

    for (const row of rows) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.patch.active !== undefined) set.active = input.patch.active;

      await tx
        .update(articles)
        .set(set)
        .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, row.id)));

      if (input.patch.categoryIds !== undefined) {
        await replaceArticleCategories(tx, {
          tenantId: input.tenantId,
          articleId: row.id,
          categoryIds: input.patch.categoryIds,
        });
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.article.bulk",
        entityType: "article",
        entityId: row.id,
        details: {
          code: row.code,
          before: { active: row.active },
          after: {
            active: input.patch.active ?? row.active,
            categories: input.patch.categoryIds?.length ?? null,
          },
        },
      });
    }
  });
}

/**
 * ART-014 — le glisser-déposer d'une carte de Kanban rattache l'article à une catégorie ; déposée sur
 * « Sans catégorie », la carte détache l'article de toutes ses catégories.
 */
export async function moveArticleToCategory(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    articleId: string;
    categoryId: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockArticle(tx, input.tenantId, input.articleId);
    const previous = await tx
      .select({ categoryId: articleCategoryLinks.categoryId })
      .from(articleCategoryLinks)
      .where(
        and(
          eq(articleCategoryLinks.tenantId, input.tenantId),
          eq(articleCategoryLinks.articleId, before.id),
        ),
      );

    await replaceArticleCategories(tx, {
      tenantId: input.tenantId,
      articleId: before.id,
      categoryIds: input.categoryId ? [input.categoryId] : [],
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.article.category",
      entityType: "article",
      entityId: before.id,
      details: {
        code: before.code,
        before: { categories: previous.map((row) => row.categoryId) },
        after: { categories: input.categoryId ? [input.categoryId] : [] },
      },
    });
  });
}
