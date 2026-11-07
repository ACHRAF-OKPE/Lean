"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule, requirePermission } from "@/lib/auth/session";
import type { CatalogFormState } from "@/lib/catalog/form-state";
import type { ReferenceCreateResult } from "@/components/reference-field";
import {
  ARTICLE_BULK_ACTIONS,
  ARTICLE_BULK_LEVELS,
  type ArticleBulkAction,
} from "@/modules/catalog/article-bulk";
import { validateArticleEdit } from "@/modules/catalog/article-edit";
import { articlesHref, parseArticleFilters } from "@/modules/catalog/article-filters";
import {
  applyArticleBulk,
  createArticleCategory,
  deleteArticle,
  deleteArticleCategory,
  deleteArticles,
  moveArticleToCategory,
  renameArticleCategory,
  setArticleCategoryActive,
  updateArticle,
  type ArticleBulkPatch,
} from "@/modules/catalog/article-queries";
import {
  PARTNER_BULK_ACTIONS,
  PARTNER_BULK_LEVELS,
  type PartnerBulkAction,
} from "@/modules/catalog/bulk";
import { categoryTitleErrors, normalizeCategoryTitle } from "@/modules/catalog/categories";
import { HEADERS_BY_KIND } from "@/modules/catalog/constants";
import { parseCoordinates } from "@/modules/catalog/coordinates";
import { CatalogError } from "@/modules/catalog/errors";
import { parsePartnerFilters, partnersHref } from "@/modules/catalog/filters";
import {
  HS_MAX_WORDING,
  validateHsCodeEdit,
  type HsCodeEditData,
} from "@/modules/catalog/hs-code-edit";
import {
  createHsCodeWithParents,
  deleteHsCode,
  listHsParentFacts,
  updateHsCode,
} from "@/modules/catalog/hs-code-queries";
import {
  HS_CODE_PATTERN,
  HS_WORDING_TO_COMPLETE,
  inheritanceFor,
  type HsCodeCreateResult,
} from "@/modules/catalog/hs-codes";
import { applyImportBatch, getImportBatchModule } from "@/modules/catalog/imports";
import { validatePartnerEdit } from "@/modules/catalog/partner-edit";
import { validatePartnerBankAccount } from "@/modules/catalog/partner-bank-account";
import { savePartnerBankAccount } from "@/modules/catalog/partner-bank-account-queries";
import {
  applyPartnerBulk,
  createCategory,
  deleteCategory,
  deletePartner,
  deletePartners,
  movePartnerToCategory,
  renameCategory,
  setCategoryActive,
  updatePartner,
  type PartnerBulkPatch,
} from "@/modules/catalog/partner-queries";
import { createArticle, createPartner, loadValidationContext } from "@/modules/catalog/queries";
import {
  validateImportRows,
  type ArticleImportData,
  type PartnerImportData,
} from "@/modules/catalog/validation";
import { PurchaseError } from "@/modules/purchases/errors";
import type { ImportKind } from "@/db/schema";
import { atLeast } from "@/modules/identity/modules";

const BOOLEAN_FIELDS = new Set(["client", "fournisseur", "vendable", "achetable", "actif"]);

function formValues(kind: ImportKind, formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const header of HEADERS_BY_KIND[kind]) {
    values[header] = BOOLEAN_FIELDS.has(header)
      ? formData.get(header) === "on"
        ? "oui"
        : "non"
      : formData.get(header);
  }
  return values;
}

function uniqueCodeError(
  code: string | null,
  existing: { has(value: string): boolean },
): string | null {
  return code && existing.has(code)
    ? `Le code ${code} est déjà utilisé dans cet espace de travail.`
    : null;
}

function failure(error: unknown): CatalogFormState {
  if (error instanceof CatalogError || error instanceof PurchaseError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function createPartnerAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "write");
  const db = getDb();
  const context = await loadValidationContext(db, session.tenantId);
  const [row] = validateImportRows(
    "partners",
    [{ rowNumber: 2, values: formValues("partners", formData) }],
    context,
  ).rows;

  if (!row) {
    return { errors: ["Formulaire vide."] };
  }

  const duplicate = uniqueCodeError(row.code, context.existingPartnerCodes);
  const coordinates = parseCoordinates(Object.fromEntries(formData));
  const errors = [...row.errors, ...(duplicate ? [duplicate] : []), ...coordinates.errors];
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createPartner(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: row.data as unknown as PartnerImportData,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      categoryIds: categoryIdsFrom(formData),
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/tiers?cree=${encodeURIComponent(row.code ?? "")}`);
}

export async function createArticleAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "write");
  const db = getDb();
  const context = await loadValidationContext(db, session.tenantId);
  const [row] = validateImportRows(
    "articles",
    [{ rowNumber: 2, values: formValues("articles", formData) }],
    context,
  ).rows;

  if (!row) {
    return { errors: ["Formulaire vide."] };
  }

  const duplicate = uniqueCodeError(row.code, context.existingArticleCodes);
  const errors = duplicate ? [...row.errors, duplicate] : row.errors;
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createArticle(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: row.data as unknown as ArticleImportData,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/articles?cree=${encodeURIComponent(row.code ?? "")}`);
}

/**
 * ART-018 — la chaîne de parents et l'héritage : un champ parent, unité ou taux laissé vide est
 * comblé par le parent le plus proche déjà présent, ou par la chaîne créée à la volée.
 */
async function createWithInheritance(
  db: ReturnType<typeof getDb>,
  input: { tenantId: string; actorUserId: string; code: string; data: HsCodeEditData },
): Promise<{ id: string; code: string; created: readonly string[]; data: HsCodeEditData }> {
  const parents = await listHsParentFacts(db, input.tenantId);
  const inherited = inheritanceFor(input.code, parents);
  const data: HsCodeEditData = {
    ...input.data,
    parentCode: input.data.parentCode ?? inherited.parentCode,
    supplementaryUnit: input.data.supplementaryUnit ?? inherited.supplementaryUnit,
    tecRate: input.data.tecRate ?? inherited.tecRate,
  };

  const created = await createHsCodeWithParents(db, { ...input, data });
  return { ...created, data };
}

/** ART-018 — le code est créé avec sa chaîne de parents, le parent, l'unité et le taux vides hérités. */
export async function createHsCodeAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("nomenclature", "write");
  const code = String(formData.get("code") ?? "").trim();
  if (!HS_CODE_PATTERN.test(code)) {
    return { errors: ["Le code SH compte 6, 8 ou 10 chiffres."] };
  }

  const { data, errors } = validateHsCodeEdit(code, Object.fromEntries(formData));
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createWithInheritance(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      code,
      data,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/nomenclature?cree=${encodeURIComponent(code)}`);
}

/**
 * GEN-015 / ART-018 — la création à la volée depuis un champ guidé : le code, ses parents et
 * l'héritage du parent le plus proche sont posés en une transaction, puis le code est rendu au champ.
 */
export async function createHsCodeOptionAction(input: {
  code: string;
  wording?: string;
}): Promise<HsCodeCreateResult> {
  const session = await requireModule("nomenclature", "write");
  const code = input.code.trim();
  if (!HS_CODE_PATTERN.test(code)) {
    return { ok: false, error: "Le code SH compte 6, 8 ou 10 chiffres." };
  }

  const wording = (input.wording ?? "").trim().slice(0, HS_MAX_WORDING) || HS_WORDING_TO_COMPLETE;

  try {
    const created = await createWithInheritance(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      code,
      data: { wording, parentCode: null, supplementaryUnit: null, tecRate: null },
    });
    revalidatePath("/nomenclature");
    return {
      ok: true,
      option: { id: created.id, code: created.code, wording, tecRate: created.data.tecRate },
      created: created.created,
    };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** ART-022 — la fiche d'un code SH se corrige ligne à ligne ; le code reste figé et l'audit garde l'avant/après. */
export async function updateHsCodeAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("nomenclature", "write");
  const hsCodeId = String(formData.get("hsCodeId") ?? "");
  if (!UUID_PATTERN.test(hsCodeId)) {
    return { errors: ["Code SH invalide."] };
  }

  const code = String(formData.get("code") ?? "").trim();
  const { data, errors } = validateHsCodeEdit(code, Object.fromEntries(formData));
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await updateHsCode(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      hsCodeId,
      data,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/nomenclature/${hsCodeId}?maj=ok`);
}

/** ART-023 — un code cité par un article, une ligne de déclaration ou portant des enfants ne se supprime pas. */
export async function deleteHsCodeAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("nomenclature", "manage");
  const hsCodeId = String(formData.get("hsCodeId") ?? "");
  if (!UUID_PATTERN.test(hsCodeId)) {
    return { errors: ["Code SH invalide."] };
  }

  try {
    await deleteHsCode(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      hsCodeId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/nomenclature?supprime=ok");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function categoryIdsFrom(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("categorie")
        .map(String)
        .filter((id) => UUID_PATTERN.test(id)),
    ),
  ];
}

function selectedIdsFrom(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("id")
        .map(String)
        .filter((id) => UUID_PATTERN.test(id)),
    ),
  ];
}

/**
 * GEN-017 — l'action en lot revient au registre dans l'état où il était. La requête repasse par les
 * mêmes gardes que l'adresse publique, puis la sélection est abandonnée : elle ne survit pas au lot.
 */
function partnersReturn(rawQuery: string, extra: Record<string, string>): string {
  const source = new URLSearchParams(rawQuery);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(source.keys())) {
    const values = source.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }

  const [, query = ""] = partnersHref(parsePartnerFilters(raw)).split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  const search = params.toString();
  return search === "" ? "/tiers" : `/tiers?${search}`;
}

/** GEN-015 — la catégorie tapée dans un champ de référence : créer relève du paramétrage du module. */
export async function createCategoryAction(title: string): Promise<ReferenceCreateResult> {
  const session = await requireModule("partners", "manage");
  const clean = normalizeCategoryTitle(title);
  const errors = categoryTitleErrors(clean);
  if (errors.length > 0) {
    return { ok: false, error: errors[0]! };
  }

  try {
    const created = await createCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      title: clean,
    });
    return { ok: true, option: { id: created.id, label: created.title } };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** ART-008 — création depuis l'écran de paramétrage, sur la même normalisation que la saisie libre. */
export async function createCategoryFormAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "manage");
  const clean = normalizeCategoryTitle(String(formData.get("titre") ?? ""));
  const errors = categoryTitleErrors(clean);
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      title: clean,
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/tiers/categories?cree=ok");
}

/** GEN-013 + ART-009 — la fiche se corrige ligne à ligne ; coordonnées et catégories suivent la même borne. */
export async function updatePartnerAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "write");
  const partnerId = String(formData.get("partnerId") ?? "");
  if (!UUID_PATTERN.test(partnerId)) {
    return { errors: ["Tiers invalide."] };
  }

  const { data, errors } = validatePartnerEdit(Object.fromEntries(formData));
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await updatePartner(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId,
      data,
      categoryIds: categoryIdsFrom(formData),
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/tiers/${partnerId}?maj=ok`);
}

/** ART-024 — coordonnées bancaires réservées aux gestionnaires Achats ou Comptabilité. */
export async function updatePartnerBankAccountAction(
  _state: { errors: readonly string[]; saved: boolean },
  formData: FormData,
): Promise<{ errors: readonly string[]; saved: boolean }> {
  const session = await requirePermission("data.write");
  const levels = await getAccessLevels(session);
  if (!atLeast(levels.purchases, "manage") && !atLeast(levels.accounting, "manage")) {
    redirect("/acces-refuse");
  }

  const partnerId = String(formData.get("partnerId") ?? "");
  if (!UUID_PATTERN.test(partnerId)) return { errors: ["Fournisseur invalide."], saved: false };
  const { data, errors } = validatePartnerBankAccount(Object.fromEntries(formData));
  if (errors.length > 0) return { errors, saved: false };

  try {
    await savePartnerBankAccount(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId,
      data,
    });
  } catch (error) {
    if (error instanceof CatalogError) return { errors: [error.message], saved: false };
    throw error;
  }
  revalidatePath(`/tiers/${partnerId}/modifier`);
  return { errors: [], saved: true };
}

/** GEN-017 — une sélection, une transaction : le lot s'applique intégralement ou rien n'est écrit. */
export async function bulkPartnerAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const rawAction = String(formData.get("action") ?? "");
  if (!(PARTNER_BULK_ACTIONS as readonly string[]).includes(rawAction)) {
    return { errors: ["Action en lot inconnue."] };
  }
  const action = rawAction as PartnerBulkAction;
  const session = await requireModule("partners", PARTNER_BULK_LEVELS[action]);
  const db = getDb();
  const ids = selectedIdsFrom(formData);

  try {
    if (action === "supprimer") {
      const levels = await getAccessLevels(session);
      await deletePartners(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        ids,
        level: levels.partners,
      });
    } else {
      let patch: PartnerBulkPatch;
      if (action === "roles") {
        const role = String(formData.get("role") ?? "");
        if (role !== "client" && role !== "fournisseur") {
          return { errors: ["Choisissez le rôle à ajouter à la sélection."] };
        }
        patch = { addRole: role };
      } else if (action === "categories") {
        patch = { categoryIds: categoryIdsFrom(formData) };
      } else if (action === "activer" || action === "desactiver") {
        patch = { active: action === "activer" };
      } else {
        return { errors: ["L'export se télécharge depuis le registre, pas par ce formulaire."] };
      }
      await applyPartnerBulk(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        ids,
        patch,
      });
    }
  } catch (error) {
    return failure(error);
  }

  redirect(partnersReturn(String(formData.get("retour") ?? ""), { lot: "ok" }));
}

/** GEN-017 — la suppression d'une fiche passe par le même plan : un tiers cité ne part pas. */
export async function deletePartnerAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "manage");
  const partnerId = String(formData.get("partnerId") ?? "");
  if (!UUID_PATTERN.test(partnerId)) {
    return { errors: ["Tiers invalide."] };
  }

  try {
    await deletePartner(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(partnersReturn(String(formData.get("retour") ?? ""), { supprime: "ok" }));
}

/** ART-008 — renommer une catégorie relève du paramétrage ; le libellé reste unique dans l'espace. */
export async function renameCategoryAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await renameCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
      title: String(formData.get("titre") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/tiers/categories?maj=ok");
}

/** ART-008 — une catégorie se désactive : elle reste sur les tiers qui la portent, hors propositions. */
export async function setCategoryActiveAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await setCategoryActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
      active: formData.get("actif") === "oui",
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/tiers/categories?maj=ok");
}

/** ART-008 — une catégorie portée par au moins un tiers ne se supprime pas : le refus est nommé. */
export async function deleteCategoryAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("partners", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await deleteCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/tiers/categories?supprime=ok");
}

export async function applyImportAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requirePermission("data.write");
  const batchId = String(formData.get("batchId") ?? "");

  if (!UUID_PATTERN.test(batchId)) {
    return { errors: ["Import invalide."] };
  }

  const moduleKey = await getImportBatchModule(getDb(), {
    tenantId: session.tenantId,
    batchId,
  });
  if (!moduleKey) {
    return { errors: ["Import introuvable dans cet espace de travail."] };
  }
  await requireModule(moduleKey, "write");

  try {
    await applyImportBatch(getDb(), {
      tenantId: session.tenantId,
      batchId,
      actorUserId: session.userId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/imports/${batchId}`);
}

/**
 * GEN-017 — l'action en lot revient au registre dans l'état où il était. La requête repasse par les
 * mêmes gardes que l'adresse publique, puis la sélection est abandonnée : elle ne survit pas au lot.
 */
function articlesReturn(rawQuery: string, extra: Record<string, string>): string {
  const source = new URLSearchParams(rawQuery);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(source.keys())) {
    const values = source.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }

  const [, query = ""] = articlesHref(parseArticleFilters(raw)).split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  const search = params.toString();
  return search === "" ? "/articles" : `/articles?${search}`;
}

/** GEN-015 — la catégorie d'article tapée dans un champ de référence : créer relève du paramétrage. */
export async function createArticleCategoryAction(title: string): Promise<ReferenceCreateResult> {
  const session = await requireModule("articles", "manage");
  const clean = normalizeCategoryTitle(title);
  const errors = categoryTitleErrors(clean);
  if (errors.length > 0) {
    return { ok: false, error: errors[0]! };
  }

  try {
    const created = await createArticleCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      title: clean,
    });
    return { ok: true, option: { id: created.id, label: created.title } };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** ART-012 — création depuis l'écran de paramétrage, sur la même normalisation que la saisie libre. */
export async function createArticleCategoryFormAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "manage");
  const clean = normalizeCategoryTitle(String(formData.get("titre") ?? ""));
  const errors = categoryTitleErrors(clean);
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createArticleCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      title: clean,
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/articles/categories?cree=ok");
}

/** ART-015 — la fiche se corrige ligne à ligne ; catégories et code SH suivent la même borne. */
export async function updateArticleAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "write");
  const articleId = String(formData.get("articleId") ?? "");
  if (!UUID_PATTERN.test(articleId)) {
    return { errors: ["Article invalide."] };
  }

  const { data, errors } = validateArticleEdit(Object.fromEntries(formData));
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await updateArticle(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      articleId,
      data,
      categoryIds: categoryIdsFrom(formData),
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/articles/${articleId}?maj=ok`);
}

/** GEN-017 — une sélection, une transaction : le lot s'applique intégralement ou rien n'est écrit. */
export async function bulkArticleAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const rawAction = String(formData.get("action") ?? "");
  if (!(ARTICLE_BULK_ACTIONS as readonly string[]).includes(rawAction)) {
    return { errors: ["Action en lot inconnue."] };
  }
  const action = rawAction as ArticleBulkAction;
  const session = await requireModule("articles", ARTICLE_BULK_LEVELS[action]);
  const db = getDb();
  const ids = selectedIdsFrom(formData);

  try {
    if (action === "supprimer") {
      const levels = await getAccessLevels(session);
      await deleteArticles(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        ids,
        level: levels.articles,
      });
    } else if (action === "exporter") {
      return { errors: ["L'export se télécharge depuis le registre, pas par ce formulaire."] };
    } else {
      let patch: ArticleBulkPatch;
      if (action === "categories") {
        patch = { categoryIds: categoryIdsFrom(formData) };
      } else {
        patch = { active: action === "activer" };
      }
      await applyArticleBulk(db, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        ids,
        patch,
      });
    }
  } catch (error) {
    return failure(error);
  }

  redirect(articlesReturn(String(formData.get("retour") ?? ""), { lot: "ok" }));
}

/** GEN-017 — la suppression d'une fiche passe par le même plan : un article cité ne part pas. */
export async function deleteArticleAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "manage");
  const articleId = String(formData.get("articleId") ?? "");
  if (!UUID_PATTERN.test(articleId)) {
    return { errors: ["Article invalide."] };
  }

  try {
    await deleteArticle(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      articleId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(articlesReturn(String(formData.get("retour") ?? ""), { supprime: "ok" }));
}

/** ART-012 — renommer une catégorie d'article relève du paramétrage ; le libellé reste unique. */
export async function renameArticleCategoryAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await renameArticleCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
      title: String(formData.get("titre") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/articles/categories?maj=ok");
}

/** ART-012 — une catégorie se désactive : elle reste sur les articles qui la portent, hors propositions. */
export async function setArticleCategoryActiveAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await setArticleCategoryActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
      active: formData.get("actif") === "oui",
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/articles/categories?maj=ok");
}

/** ART-012 — une catégorie portée par au moins un article ne se supprime pas : le refus est nommé. */
export async function deleteArticleCategoryAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("articles", "manage");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!UUID_PATTERN.test(categoryId)) {
    return { errors: ["Catégorie invalide."] };
  }

  try {
    await deleteArticleCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      categoryId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/articles/categories?supprime=ok");
}

/** ART-014 — le dépôt d'une carte de Kanban rattache l'article à la catégorie visée. */
export async function moveArticleCategoryAction(input: {
  articleId: string;
  categoryId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireModule("articles", "write");
  if (!UUID_PATTERN.test(input.articleId)) {
    return { ok: false, error: "Article invalide." };
  }
  if (input.categoryId !== null && !UUID_PATTERN.test(input.categoryId)) {
    return { ok: false, error: "Catégorie invalide." };
  }

  try {
    await moveArticleToCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      articleId: input.articleId,
      categoryId: input.categoryId,
    });
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/articles");
  return { ok: true };
}

/** ART-016 — le dépôt d'une carte de Kanban rattache le tiers à la catégorie visée. */
export async function movePartnerCategoryAction(input: {
  partnerId: string;
  categoryId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireModule("partners", "write");
  if (!UUID_PATTERN.test(input.partnerId)) {
    return { ok: false, error: "Tiers invalide." };
  }
  if (input.categoryId !== null && !UUID_PATTERN.test(input.categoryId)) {
    return { ok: false, error: "Catégorie invalide." };
  }

  try {
    await movePartnerToCategory(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId: input.partnerId,
      categoryId: input.categoryId,
    });
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/tiers");
  return { ok: true };
}
