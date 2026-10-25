"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import type { CatalogFormState } from "@/lib/catalog/form-state";
import { HEADERS_BY_KIND } from "@/modules/catalog/constants";
import { CatalogError } from "@/modules/catalog/errors";
import { applyImportBatch } from "@/modules/catalog/imports";
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
  const session = await requirePermission("data.write");
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
  const errors = duplicate ? [...row.errors, duplicate] : row.errors;
  if (errors.length > 0) {
    return { errors };
  }

  try {
    await createPartner(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: row.data as unknown as PartnerImportData,
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
  const session = await requirePermission("data.write");
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
  const session = await requirePermission("data.write");
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

export async function applyImportAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const session = await requirePermission("data.write");
  const batchId = String(formData.get("batchId") ?? "");

  if (!UUID_PATTERN.test(batchId)) {
    return { errors: ["Import invalide."] };
  }

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
