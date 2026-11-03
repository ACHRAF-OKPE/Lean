import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, tenants, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { EMPTY_ARTICLE_LIST_FILTERS } from "./article-filters";
import {
  applyArticleBulk,
  createArticleCategory,
  deleteArticleCategory,
  deleteArticles,
  listArticleCategories,
  moveArticleToCategory,
} from "./article-queries";
import { createArticle, createHsCode, listArticles } from "./queries";
import type { ArticleImportData } from "./validation";

let context: TestDatabase;
let db: Database;
let actorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  const [actor] = await db
    .insert(users)
    .values({ email: "articles@lean.example", name: "Awa", passwordHash: "scrypt-test" })
    .returning({ id: users.id });
  if (!actor) {
    throw new Error("Utilisateur de test non créé.");
  }
  actorId = actor.id;
});

afterAll(async () => {
  await context.close();
});

async function makeTenant(slug: string): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug, name: `Espace ${slug}` })
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Tenant de test non créé.");
  }
  return row.id;
}

function data(overrides: Partial<ArticleImportData> = {}): ArticleImportData {
  return {
    code: "SRV001",
    name: "Transport routier",
    description: null,
    type: "service",
    unitCode: "KG",
    hsCode: null,
    salePriceXof: 1500,
    purchasePriceXof: 0,
    isSellable: true,
    isPurchasable: false,
    countryOfOrigin: null,
    active: true,
    ...overrides,
  };
}

describe("ART-012 — catégories d'articles portées par l'espace", () => {
  it("refuse un doublon de libellé, refuse la suppression d'une catégorie portée, et isole l'espace", async () => {
    const tenantId = await makeTenant("art-cat-a");
    const otherId = await makeTenant("art-cat-b");
    const category = await createArticleCategory(db, {
      tenantId,
      actorUserId: actorId,
      title: "Denrées",
    });
    await expect(
      createArticleCategory(db, { tenantId, actorUserId: actorId, title: "denrées" }),
    ).rejects.toThrow(/existe déjà/);

    const article = await createArticle(db, { tenantId, actorUserId: actorId, data: data() });
    await applyArticleBulk(db, {
      tenantId,
      actorUserId: actorId,
      ids: [article.id],
      patch: { categoryIds: [category.id] },
    });

    await expect(
      deleteArticleCategory(db, { tenantId, actorUserId: actorId, categoryId: category.id }),
    ).rejects.toThrow(/désactivez-la/);

    const [listed] = await listArticleCategories(db, tenantId);
    expect(listed?.articleCount).toBe(1);

    const other = await listArticleCategories(db, otherId);
    expect(other).toEqual([]);
  });
});

describe("ART-013 — le registre des articles se filtre dans l'espace", () => {
  it("combine recherche, type et état, et ne traverse pas l'espace voisin", async () => {
    const tenantId = await makeTenant("art-fil-a");
    const otherId = await makeTenant("art-fil-b");
    await createHsCode(db, {
      tenantId,
      actorUserId: actorId,
      data: {
        code: "090111",
        wording: "Café non torréfié",
        parentCode: null,
        supplementaryUnit: null,
        tecRate: null,
      },
    });
    await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: data({
        code: "ART010",
        name: "Café vert",
        type: "product",
        hsCode: "090111",
      }),
    });
    await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "SRV010", name: "Maintenance", active: false }),
    });
    await createArticle(db, {
      tenantId: otherId,
      actorUserId: actorId,
      data: data({ code: "ART010", name: "Café vert" }),
    });

    const byProduct = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      types: ["product"],
    });
    expect(byProduct.rows.map((row) => row.code)).toEqual(["ART010"]);

    const inactive = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      state: "inactif",
    });
    expect(inactive.rows.map((row) => row.code)).toEqual(["SRV010"]);

    const searched = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      search: "café",
    });
    expect(searched.total).toBe(1);

    const other = await listArticles(db, otherId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      search: "café",
    });
    expect(other.total).toBe(1);
    expect(other.rows[0]?.id).not.toBe(byProduct.rows[0]?.id);
  });
});

describe("ART-014 — glisser-déposer entre colonnes de catégories", () => {
  it("rattache, remplace puis détache la catégorie de l'article, et trace chaque geste", async () => {
    const tenantId = await makeTenant("art-dnd-a");
    const denrees = await createArticleCategory(db, {
      tenantId,
      actorUserId: actorId,
      title: "Denrées",
    });
    const importable = await createArticleCategory(db, {
      tenantId,
      actorUserId: actorId,
      title: "Import",
    });
    const article = await createArticle(db, { tenantId, actorUserId: actorId, data: data() });

    await moveArticleToCategory(db, {
      tenantId,
      actorUserId: actorId,
      articleId: article.id,
      categoryId: denrees.id,
    });
    const pulled = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      categoryIds: [denrees.id],
    });
    expect(pulled.rows.map((row) => row.id)).toEqual([article.id]);

    await moveArticleToCategory(db, {
      tenantId,
      actorUserId: actorId,
      articleId: article.id,
      categoryId: importable.id,
    });
    const moved = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      categoryIds: [importable.id],
    });
    expect(moved.rows.map((row) => row.id)).toEqual([article.id]);
    const left = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      categoryIds: [denrees.id],
    });
    expect(left.rows).toEqual([]);

    await moveArticleToCategory(db, {
      tenantId,
      actorUserId: actorId,
      articleId: article.id,
      categoryId: null,
    });
    const detached = await listArticles(db, tenantId, {
      ...EMPTY_ARTICLE_LIST_FILTERS,
      categoryIds: [importable.id],
    });
    expect(detached.rows).toEqual([]);

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId));
    expect(events.filter((event) => event.action === "catalog.article.category")).toHaveLength(3);
  });
});

describe("GEN-017 — suppression en lot des articles", () => {
  it("supprime un lot libre et trace un évènement par article", async () => {
    const tenantId = await makeTenant("art-bulk-a");
    const first = await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "SRV020" }),
    });
    const second = await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "SRV021", name: "Libre" }),
    });

    await deleteArticles(db, {
      tenantId,
      actorUserId: actorId,
      ids: [first.id, second.id],
      level: "manage",
    });

    expect((await listArticles(db, tenantId)).total).toBe(0);
    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId));
    expect(events.filter((event) => event.action === "catalog.article.delete")).toHaveLength(2);
  });

  it("refuse la suppression au niveau écriture", async () => {
    const tenantId = await makeTenant("art-bulk-b");
    const created = await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "SRV030" }),
    });
    await expect(
      deleteArticles(db, {
        tenantId,
        actorUserId: actorId,
        ids: [created.id],
        level: "write",
      }),
    ).rejects.toThrow(/niveau de droit plus élevé/);
    expect((await listArticles(db, tenantId)).total).toBe(1);
  });
});
