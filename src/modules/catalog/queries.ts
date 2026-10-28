import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  hsCodes,
  partners,
  type ArticleType,
  type PartnerType,
} from "@/db/schema";
import { CatalogError } from "./errors";
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

export async function listPartners(
  db: Database,
  tenantId: string,
): Promise<CatalogPage<PartnerSummary>> {
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
        active: partners.active,
      })
      .from(partners)
      .where(eq(partners.tenantId, tenantId))
      .orderBy(asc(partners.name), asc(partners.code))
      .limit(LIST_LIMIT),
    db.select({ value: count() }).from(partners).where(eq(partners.tenantId, tenantId)),
  ]);

  return { rows, total: totalRow?.value ?? 0, limit: LIST_LIMIT };
}

export interface PartnerDetail extends PartnerSummary {
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly taxNumber: string | null;
}

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
      active: partners.active,
      email: partners.email,
      phone: partners.phone,
      addressLine: partners.addressLine,
      taxNumber: partners.taxNumber,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, input.partnerId)))
    .limit(1);
  return row ?? null;
}

export async function listArticles(
  db: Database,
  tenantId: string,
): Promise<CatalogPage<ArticleSummary>> {
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
      .where(eq(articles.tenantId, tenantId))
      .orderBy(asc(articles.name), asc(articles.code))
      .limit(LIST_LIMIT),
    db.select({ value: count() }).from(articles).where(eq(articles.tenantId, tenantId)),
  ]);

  return { rows, total: totalRow?.value ?? 0, limit: LIST_LIMIT };
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
  input: { tenantId: string; actorUserId: string; data: PartnerImportData },
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
          active: data.active,
        })
        .returning({ id: partners.id, code: partners.code });

      if (!created) {
        throw new CatalogError("Le tiers n'a pas pu être créé.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.partner.create",
        entityType: "partner",
        entityId: created.id,
        details: { code: created.code, name: data.name },
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
