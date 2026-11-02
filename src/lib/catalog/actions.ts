"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule, requirePermission } from "@/lib/auth/session";
import type { CatalogFormState } from "@/lib/catalog/form-state";
import type { ReferenceCreateResult } from "@/components/reference-field";
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
import { applyImportBatch, getImportBatchModule } from "@/modules/catalog/imports";
import { validatePartnerEdit } from "@/modules/catalog/partner-edit";
import {
  applyPartnerBulk,
  createCategory,
  deleteCategory,
  deletePartner,
  deletePartners,
  renameCategory,
  setCategoryActive,
  updatePartner,
  type PartnerBulkPatch,
} from "@/modules/catalog/partner-queries";
import {
  createArticle,
  createHsCode,
  createPartner,
  loadValidationContext,
} from "@/modules/catalog/queries";
import {
  validateImportRows,
  type ArticleImportData,
  type HsImportData,
  type PartnerImportData,
} from "@/modules/catalog/validation";
import { PurchaseError } from "@/modules/purchases/errors";
import type { ImportKind } from "@/db/schema";

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

export async function createHsCodeAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requireModule("nomenclature", "write");
  const db = getDb();
  const context = await loadValidationContext(db, session.tenantId);
  const [row] = validateImportRows(
    "hs_codes",
    [{ rowNumber: 2, values: formValues("hs_codes", formData) }],
    context,
  ).rows;

  if (!row) {
    return { errors: ["Formulaire vide."] };
  }

  const duplicate = uniqueCodeError(row.code, context.existingHsCodes);
  const errors = duplicate ? [...row.errors, duplicate] : row.errors;
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createHsCode(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: row.data as unknown as HsImportData,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/nomenclature?cree=${encodeURIComponent(row.code ?? "")}`);
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
