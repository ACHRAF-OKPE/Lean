import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  hsCodes,
  partners,
  type ArticleType,
  type PartnerType,
} from "@/db/schema";
import { EMPTY_ARTICLE_LIST_FILTERS, type ArticleListFilters } from "./article-filters";
import { articleIdsByCategories } from "./article-queries";
import { CatalogError } from "./errors";
import { EMPTY_PARTNER_LIST_FILTERS, type PartnerListFilters } from "./filters";
import { partnerIdsByCategories, replacePartnerCategories } from "./partner-queries";
import type {
  ArticleImportData,
  HsImportData,
  PartnerImportData,
  ValidationContext,
} from "./validation";

const LIST_LIMIT = 200;

export interface PartnerSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: PartnerType;
  readonly isCustomer: boolean;
  readonly isSupplier: boolean;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly paymentTermDays: number;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly taxNumber: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly active: boolean;
}

export interface ArticleSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly hsCode: string | null;
  readonly salePriceXof: number;
  readonly purchasePriceXof: number;
  readonly isSellable: boolean;
  readonly isPurchasable: boolean;
  readonly active: boolean;
}

export interface HsCodeSummary {
  readonly id: string;
  readonly code: string;
  readonly wording: string;
  readonly parentCode: string | null;
  readonly supplementaryUnit: string | null;
  readonly tecRate: number | null;
}

export interface CatalogPage<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly limit: number;
}

export interface CreatedRecord {
  readonly id: string;
  readonly code: string;
}

export interface CatalogCounts {
  readonly partners: number;
  readonly articles: number;
  readonly hsCodes: number;
}

export async function getCatalogCounts(db: Database, tenantId: string): Promise<CatalogCounts> {
  const [[partnerRow], [articleRow], [hsRow]] = await Promise.all([
    db.select({ value: count() }).from(partners).where(eq(partners.tenantId, tenantId)),
    db.select({ value: count() }).from(articles).where(eq(articles.tenantId, tenantId)),
    db.select({ value: count() }).from(hsCodes).where(eq(hsCodes.tenantId, tenantId)),
  ]);

  return {
    partners: partnerRow?.value ?? 0,
    articles: articleRow?.value ?? 0,
    hsCodes: hsRow?.value ?? 0,
  };
}

export async function loadValidationContext(
  db: Database,
  tenantId: string,
): Promise<ValidationContext> {
  const [partnerRows, articleRows, hsRows] = await Promise.all([
    db
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        active: partners.active,
        isCustomer: partners.isCustomer,
        isSupplier: partners.isSupplier,
      })
      .from(partners)
      .where(eq(partners.tenantId, tenantId)),
    db
      .select({
        id: articles.id,
        code: articles.code,
        name: articles.name,
        type: articles.type,
        unitCode: articles.unitCode,
        active: articles.active,
        isPurchasable: articles.isPurchasable,
        purchasePriceXof: articles.purchasePriceXof,
        isSellable: articles.isSellable,
        salePriceXof: articles.salePriceXof,
      })
      .from(articles)
      .where(eq(articles.tenantId, tenantId)),
    db
      .select({
        id: hsCodes.id,
        code: hsCodes.code,
        wording: hsCodes.wording,
        tecRate: hsCodes.tecRate,
      })
      .from(hsCodes)
      .where(eq(hsCodes.tenantId, tenantId)),
  ]);

  return {
    existingPartnerCodes: new Set(partnerRows.map((row) => row.code)),
    existingArticleCodes: new Set(articleRows.map((row) => row.code)),
    existingHsCodes: new Map(hsRows.map((row) => [row.code, row.wording])),
    suppliersByCode: new Map(partnerRows.map((row) => [row.code, row])),
    customersByCode: new Map(partnerRows.map((row) => [row.code, row])),
    articlesByCode: new Map(articleRows.map((row) => [row.code, row])),
    salesArticlesByCode: new Map(articleRows.map((row) => [row.code, row])),
    customsHsCodesByCode: new Map(
      hsRows.map((row) => [row.code, { id: row.id, tecRate: row.tecRate }]),
    ),
  };
}

/** ART-010 — la catégorie passe par une lecture séparée, jamais par du SQL concaténé. */
export async function listPartners(
  db: Database,
  tenantId: string,
  filters: PartnerListFilters = EMPTY_PARTNER_LIST_FILTERS,
): Promise<CatalogPage<PartnerSummary>> {
  const conditions: (SQL | undefined)[] = [eq(partners.tenantId, tenantId)];

  if (filters.search !== "") {
    const like = `%${filters.search}%`;
    conditions.push(or(ilike(partners.code, like), ilike(partners.name, like)));
  }
  if (filters.roles.length > 0) {
    conditions.push(
      or(
        ...filters.roles.map((role) =>
          role === "client" ? eq(partners.isCustomer, true) : eq(partners.isSupplier, true),
        ),
      ),
    );
  }
  if (filters.state) {
    conditions.push(eq(partners.active, filters.state === "actif"));
  }
  if (filters.countryCode) {
    conditions.push(eq(partners.countryCode, filters.countryCode));
  }
  if (filters.ids.length > 0) {
    conditions.push(inArray(partners.id, [...filters.ids]));
  }
  if (filters.categoryIds.length > 0) {
    const ids = await partnerIdsByCategories(db, tenantId, filters.categoryIds);
    if (ids.length === 0) {
      return { rows: [], total: 0, limit: LIST_LIMIT };
    }
    conditions.push(inArray(partners.id, ids));
  }

  const where = and(...conditions);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        type: partners.type,
        isCustomer: partners.isCustomer,
        isSupplier: partners.isSupplier,
        city: partners.city,
        countryCode: partners.countryCode,
        paymentTermDays: partners.paymentTermDays,
        email: partners.email,
        phone: partners.phone,
        addressLine: partners.addressLine,
        taxNumber: partners.taxNumber,
        latitude: partners.latitude,
        longitude: partners.longitude,
        active: partners.active,
      })
      .from(partners)
      .where(where)
      .orderBy(asc(partners.name), asc(partners.code))
      .limit(LIST_LIMIT),
    db.select({ value: count() }).from(partners).where(where),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
    })),
    total: totalRow?.value ?? 0,
    limit: LIST_LIMIT,
  };
}

export type PartnerDetail = PartnerSummary;

export async function getPartner(
  db: Database,
  input: { tenantId: string; partnerId: string },
): Promise<PartnerDetail | null> {
  const [row] = await db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      type: partners.type,
      isCustomer: partners.isCustomer,
      isSupplier: partners.isSupplier,
      city: partners.city,
      countryCode: partners.countryCode,
      paymentTermDays: partners.paymentTermDays,
      latitude: partners.latitude,
      longitude: partners.longitude,
      active: partners.active,
      email: partners.email,
      phone: partners.phone,
      addressLine: partners.addressLine,
      taxNumber: partners.taxNumber,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, input.partnerId)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...row,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

/** ART-013 — la catégorie passe par une lecture séparée, jamais par du SQL concaténé. */
export async function listArticles(
  db: Database,
  tenantId: string,
  filters: ArticleListFilters = EMPTY_ARTICLE_LIST_FILTERS,
): Promise<CatalogPage<ArticleSummary>> {
  const conditions: (SQL | undefined)[] = [eq(articles.tenantId, tenantId)];

  if (filters.search !== "") {
    const like = `%${filters.search}%`;
    conditions.push(or(ilike(articles.code, like), ilike(articles.name, like)));
  }
  if (filters.types.length > 0) {
    conditions.push(inArray(articles.type, [...filters.types]));
  }
  if (filters.state) {
    conditions.push(eq(articles.active, filters.state === "actif"));
  }
  if (filters.ids.length > 0) {
    conditions.push(inArray(articles.id, [...filters.ids]));
  }
  if (filters.categoryIds.length > 0) {
    const ids = await articleIdsByCategories(db, tenantId, filters.categoryIds);
    if (ids.length === 0) {
      return { rows: [], total: 0, limit: LIST_LIMIT };
    }
    conditions.push(inArray(articles.id, ids));
  }

  const where = and(...conditions);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: articles.id,
        code: articles.code,
        name: articles.name,
        type: articles.type,
        unitCode: articles.unitCode,
        hsCode: hsCodes.code,
        salePriceXof: articles.salePriceXof,
        purchasePriceXof: articles.purchasePriceXof,
        isSellable: articles.isSellable,
        isPurchasable: articles.isPurchasable,
        active: articles.active,
      })
      .from(articles)
      .leftJoin(
        hsCodes,
        and(eq(hsCodes.tenantId, articles.tenantId), eq(hsCodes.id, articles.hsCodeId)),
      )
      .where(where)
      .orderBy(asc(articles.name), asc(articles.code))
      .limit(LIST_LIMIT),
    db.select({ value: count() }).from(articles).where(where),
  ]);

  return { rows, total: totalRow?.value ?? 0, limit: LIST_LIMIT };
}

/** ART-015 — la fiche article montre tout ce que l'édition peut reprendre. */
export interface ArticleDetail extends ArticleSummary {
  readonly description: string | null;
  readonly countryOfOrigin: string | null;
}

export async function getArticle(
  db: Database,
  input: { tenantId: string; articleId: string },
): Promise<ArticleDetail | null> {
  const [row] = await db
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      description: articles.description,
      type: articles.type,
      unitCode: articles.unitCode,
      hsCode: hsCodes.code,
      salePriceXof: articles.salePriceXof,
      purchasePriceXof: articles.purchasePriceXof,
      isSellable: articles.isSellable,
      isPurchasable: articles.isPurchasable,
      countryOfOrigin: articles.countryOfOrigin,
      active: articles.active,
    })
    .from(articles)
    .leftJoin(
      hsCodes,
      and(eq(hsCodes.tenantId, articles.tenantId), eq(hsCodes.id, articles.hsCodeId)),
    )
    .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, input.articleId)))
    .limit(1);

  if (!row) {
    return null;
  }

  return row;
}

export async function listHsCodes(
  db: Database,
  tenantId: string,
): Promise<CatalogPage<HsCodeSummary>> {
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: hsCodes.id,
        code: hsCodes.code,
        wording: hsCodes.wording,
        parentCode: hsCodes.parentCode,
        supplementaryUnit: hsCodes.supplementaryUnit,
        tecRate: hsCodes.tecRate,
      })
      .from(hsCodes)
      .where(eq(hsCodes.tenantId, tenantId))
      .orderBy(asc(hsCodes.code))
      .limit(LIST_LIMIT),
    db.select({ value: count() }).from(hsCodes).where(eq(hsCodes.tenantId, tenantId)),
  ]);

  return { rows, total: totalRow?.value ?? 0, limit: LIST_LIMIT };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function withUniqueCode(error: unknown, code: string): never {
  if (isUniqueViolation(error)) {
    throw new CatalogError(`Le code ${code} est déjà utilisé dans cet espace de travail.`);
  }
  throw error;
}

export async function createPartner(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    data: PartnerImportData;
    latitude?: string | null;
    longitude?: string | null;
    categoryIds?: readonly string[];
  },
): Promise<CreatedRecord> {
  const { data } = input;
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(partners)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          name: data.name,
          type: data.type,
          isCustomer: data.isCustomer,
          isSupplier: data.isSupplier,
          email: data.email,
          phone: data.phone,
          addressLine: data.addressLine,
          city: data.city,
          countryCode: data.countryCode,
          taxNumber: data.taxNumber,
          paymentTermDays: data.paymentTermDays,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          active: data.active,
        })
        .returning({ id: partners.id, code: partners.code });

      if (!created) {
        throw new CatalogError("Le tiers n'a pas pu être créé.");
      }

      await replacePartnerCategories(tx, {
        tenantId: input.tenantId,
        partnerId: created.id,
        categoryIds: input.categoryIds ?? [],
      });

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.partner.create",
        entityType: "partner",
        entityId: created.id,
        details: {
          code: created.code,
          name: data.name,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
      });

      return created;
    });
  } catch (error) {
    return withUniqueCode(error, data.code);
  }
}

export async function createArticle(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: ArticleImportData },
): Promise<CreatedRecord> {
  const { data } = input;
  try {
    return await db.transaction(async (tx) => {
      let hsCodeId: string | null = null;
      if (data.type === "product") {
        if (!data.hsCode) {
          throw new CatalogError("Un produit exige un code SH.");
        }
        const [hsCode] = await tx
          .select({ id: hsCodes.id })
          .from(hsCodes)
          .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.code, data.hsCode)))
          .limit(1);
        if (!hsCode) {
          throw new CatalogError(
            `Le code SH ${data.hsCode} n'existe pas dans cet espace : importez la nomenclature d'abord.`,
          );
        }
        hsCodeId = hsCode.id;
      }

      const [created] = await tx
        .insert(articles)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          name: data.name,
          description: data.description,
          type: data.type,
          unitCode: data.unitCode,
          hsCodeId,
          salePriceXof: data.salePriceXof,
          purchasePriceXof: data.purchasePriceXof,
          isSellable: data.isSellable,
          isPurchasable: data.isPurchasable,
          countryOfOrigin: data.countryOfOrigin,
          active: data.active,
        })
        .returning({ id: articles.id, code: articles.code });

      if (!created) {
        throw new CatalogError("L'article n'a pas pu être créé.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.article.create",
        entityType: "article",
        entityId: created.id,
        details: { code: created.code, name: data.name, type: data.type },
      });

      return created;
    });
  } catch (error) {
    return withUniqueCode(error, data.code);
  }
}

export async function createHsCode(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: HsImportData },
): Promise<CreatedRecord> {
  const { data } = input;
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hsCodes)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          wording: data.wording,
          parentCode: data.parentCode,
          supplementaryUnit: data.supplementaryUnit,
          tecRate: data.tecRate,
        })
        .returning({ id: hsCodes.id, code: hsCodes.code });

      if (!created) {
        throw new CatalogError("Le code SH n'a pas pu être créé.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.hs_code.create",
        entityType: "hs_code",
        entityId: created.id,
        details: { code: created.code, wording: data.wording },
      });

      return created;
    });
  } catch (error) {
    return withUniqueCode(error, data.code);
  }
}
