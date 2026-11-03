import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { articles, auditEvents, customsDeclarationLines, hsCodes } from "@/db/schema";
import { CatalogError } from "./errors";
import type { HsCodeEditData } from "./hs-code-edit";
import {
  HS_WORDING_TO_COMPLETE,
  deriveParentCode,
  missingParentCodes,
  parentCandidates,
  type HsParentFacts,
} from "./hs-codes";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface HsCodeChild {
  readonly id: string;
  readonly code: string;
  readonly wording: string;
  readonly tecRate: number | null;
}

export interface HsCodeDetail {
  readonly id: string;
  readonly code: string;
  readonly wording: string;
  readonly parentCode: string | null;
  readonly parent: { readonly id: string; readonly code: string; readonly wording: string } | null;
  readonly supplementaryUnit: string | null;
  readonly tecRate: number | null;
  readonly children: readonly HsCodeChild[];
  readonly usage: {
    readonly articles: readonly {
      readonly id: string;
      readonly code: string;
      readonly name: string;
    }[];
    readonly declarationLines: number;
  };
}

async function lockHsCode(
  tx: Transaction,
  tenantId: string,
  hsCodeId: string,
): Promise<{ id: string; code: string; wording: string; tecRate: number | null }> {
  const [row] = await tx
    .select({
      id: hsCodes.id,
      code: hsCodes.code,
      wording: hsCodes.wording,
      tecRate: hsCodes.tecRate,
    })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, tenantId), eq(hsCodes.id, hsCodeId)))
    .for("update")
    .limit(1);

  if (!row) {
    throw new CatalogError("Code SH introuvable dans cet espace de travail.");
  }
  return row;
}

/** ART-021 — la fiche d'un code SH : son parent, ses enfants et ce qui le référence. */
export async function getHsCodeDetail(
  db: Database,
  input: { tenantId: string; hsCodeId: string },
): Promise<HsCodeDetail | null> {
  const [row] = await db
    .select({
      id: hsCodes.id,
      code: hsCodes.code,
      wording: hsCodes.wording,
      parentCode: hsCodes.parentCode,
      supplementaryUnit: hsCodes.supplementaryUnit,
      tecRate: hsCodes.tecRate,
    })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.id, input.hsCodeId)))
    .limit(1);

  if (!row) {
    return null;
  }

  const [parent, children, usageArticles, [declarationCount]] = await Promise.all([
    row.parentCode
      ? db
          .select({ id: hsCodes.id, code: hsCodes.code, wording: hsCodes.wording })
          .from(hsCodes)
          .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.code, row.parentCode)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        id: hsCodes.id,
        code: hsCodes.code,
        wording: hsCodes.wording,
        tecRate: hsCodes.tecRate,
      })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.parentCode, row.code)))
      .orderBy(asc(hsCodes.code)),
    db
      .select({ id: articles.id, code: articles.code, name: articles.name })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), eq(articles.hsCodeId, row.id)))
      .orderBy(asc(articles.code)),
    db
      .select({ value: count() })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.hsCodeId, row.id),
        ),
      ),
  ]);

  return {
    ...row,
    parent,
    children,
    usage: { articles: usageArticles, declarationLines: declarationCount?.value ?? 0 },
  };
}

export interface HsCodeUsage {
  readonly articles: number;
  readonly declarationLines: number;
  readonly children: number;
}

const ZERO_USAGE: HsCodeUsage = { articles: 0, declarationLines: 0, children: 0 };

/** ART-019 / ART-023 — combien d'articles, de lignes de déclaration et d'enfants citent chaque code du jeu. */
async function computeUsageCounts(
  db: Database,
  tenantId: string,
  hsCodeIds: readonly string[],
): Promise<Map<string, HsCodeUsage>> {
  const targets = [...new Set(hsCodeIds)];
  const result = new Map<string, HsCodeUsage>();
  if (targets.length === 0) {
    return result;
  }

  const targetRows = await db
    .select({ id: hsCodes.id, code: hsCodes.code })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, tenantId), inArray(hsCodes.id, targets)));
  const idByCode = new Map(targetRows.map((row) => [row.code, row.id]));

  const [articleRows, lineRows, childRows] = await Promise.all([
    db
      .select({ hsCodeId: articles.hsCodeId, value: count() })
      .from(articles)
      .where(and(eq(articles.tenantId, tenantId), inArray(articles.hsCodeId, targets)))
      .groupBy(articles.hsCodeId),
    db
      .select({ hsCodeId: customsDeclarationLines.hsCodeId, value: count() })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, tenantId),
          inArray(customsDeclarationLines.hsCodeId, targets),
        ),
      )
      .groupBy(customsDeclarationLines.hsCodeId),
    db
      .select({ parentCode: hsCodes.parentCode, value: count() })
      .from(hsCodes)
      .where(
        and(
          eq(hsCodes.tenantId, tenantId),
          inArray(
            hsCodes.parentCode,
            targetRows.map((row) => row.code),
          ),
        ),
      )
      .groupBy(hsCodes.parentCode),
  ]);

  const bump = (id: string | null | undefined, key: keyof HsCodeUsage, value: number): void => {
    if (!id) {
      return;
    }
    const current = result.get(id) ?? ZERO_USAGE;
    result.set(id, { ...current, [key]: current[key] + Number(value) });
  };

  for (const row of articleRows) {
    bump(row.hsCodeId, "articles", Number(row.value));
  }
  for (const row of lineRows) {
    bump(row.hsCodeId, "declarationLines", Number(row.value));
  }
  for (const row of childRows) {
    // Les enfants sont retrouvés par code : la fiche refuse alors la suppression du parent.
    bump(idByCode.get(row.parentCode ?? ""), "children", Number(row.value));
  }

  return result;
}

/**
 * ART-018 — les faits des parents déjà présents, indexés par code : l'héritage du taux TEC et de
 * l'unité complémentaire s'y lit au moment de créer un enfant à la volée.
 */
export async function listHsParentFacts(
  db: Database,
  tenantId: string,
): Promise<Map<string, HsParentFacts>> {
  const rows = await db
    .select({
      code: hsCodes.code,
      supplementaryUnit: hsCodes.supplementaryUnit,
      tecRate: hsCodes.tecRate,
    })
    .from(hsCodes)
    .where(eq(hsCodes.tenantId, tenantId));

  return new Map(
    rows.map((row) => [
      row.code,
      { supplementaryUnit: row.supplementaryUnit, tecRate: row.tecRate },
    ]),
  );
}

/** ART-019 — le compteur d'usage d'un jeu filtré, pour l'afficher dans le registre. */
export function hsCodeUsageCounts(
  db: Database,
  tenantId: string,
  hsCodeIds: readonly string[],
): Promise<Map<string, HsCodeUsage>> {
  return computeUsageCounts(db, tenantId, hsCodeIds);
}

/** ART-023 — ce qui empêche la suppression d'un code : les articles, les lignes de déclaration et les enfants qui le citent. */
export async function hsCodeUsageReferences(
  db: Database,
  tenantId: string,
  hsCodeIds: readonly string[],
): Promise<Map<string, string[]>> {
  const counts = await computeUsageCounts(db, tenantId, hsCodeIds);
  const labels = new Map<string, string[]>();
  for (const [id, usage] of counts) {
    const list: string[] = [];
    if (usage.articles > 0) {
      list.push(`articles (${usage.articles})`);
    }
    if (usage.declarationLines > 0) {
      list.push(`lignes de déclaration (${usage.declarationLines})`);
    }
    if (usage.children > 0) {
      list.push(`codes enfants (${usage.children})`);
    }
    if (list.length > 0) {
      labels.set(id, list);
    }
  }
  return labels;
}

/**
 * ART-018 — la chaîne des parents d'un code est créée si elle manque, du plus lointain au plus proche,
 * chaque parent portant le libellé « à compléter » et sa propre trace d'audit.
 */
export async function ensureHsCodeParents(
  tx: Transaction,
  input: { tenantId: string; actorUserId: string; code: string },
): Promise<readonly string[]> {
  const candidates = parentCandidates(input.code);
  if (candidates.length === 0) {
    return [];
  }

  const known = await tx
    .select({ code: hsCodes.code })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, input.tenantId), inArray(hsCodes.code, [...candidates])));
  const existing = new Set(known.map((row) => row.code));

  const created: string[] = [];
  for (const parent of missingParentCodes(input.code, existing)) {
    const [inserted] = await tx
      .insert(hsCodes)
      .values({
        tenantId: input.tenantId,
        code: parent,
        wording: HS_WORDING_TO_COMPLETE,
        parentCode: deriveParentCode(parent),
        supplementaryUnit: null,
        tecRate: null,
      })
      .onConflictDoNothing({ target: [hsCodes.tenantId, hsCodes.code] })
      .returning({ id: hsCodes.id, code: hsCodes.code });

    if (!inserted) {
      continue;
    }

    created.push(inserted.code);
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.hs_code.create",
      entityType: "hs_code",
      entityId: inserted.id,
      details: { code: inserted.code, wording: HS_WORDING_TO_COMPLETE, auto: true },
    });
  }

  return created;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

/** ART-018 — le code est créé avec sa chaîne de parents, la chaîne manquante étant complétée à la volée. */
export async function createHsCodeWithParents(
  db: Database,
  input: { tenantId: string; actorUserId: string; code: string; data: HsCodeEditData },
): Promise<{ id: string; code: string; created: readonly string[] }> {
  try {
    return await db.transaction(async (tx) => {
      const created = await ensureHsCodeParents(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        code: input.code,
      });

      const [row] = await tx
        .insert(hsCodes)
        .values({
          tenantId: input.tenantId,
          code: input.code,
          wording: input.data.wording,
          parentCode: input.data.parentCode,
          supplementaryUnit: input.data.supplementaryUnit,
          tecRate: input.data.tecRate,
        })
        .returning({ id: hsCodes.id, code: hsCodes.code });

      if (!row) {
        throw new CatalogError("Le code SH n'a pas pu être créé.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.hs_code.create",
        entityType: "hs_code",
        entityId: row.id,
        details: { code: row.code, wording: input.data.wording },
      });

      return { ...row, created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CatalogError(`Le code ${input.code} est déjà utilisé dans cet espace de travail.`);
    }
    throw error;
  }
}

/** ART-022 — la fiche se corrige ligne à ligne ; le code reste l'identifiant figé, l'audit garde l'avant/après. */
export async function updateHsCode(
  db: Database,
  input: { tenantId: string; actorUserId: string; hsCodeId: string; data: HsCodeEditData },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockHsCode(tx, input.tenantId, input.hsCodeId);

    await tx
      .update(hsCodes)
      .set({
        wording: input.data.wording,
        parentCode: input.data.parentCode,
        supplementaryUnit: input.data.supplementaryUnit,
        tecRate: input.data.tecRate,
        updatedAt: new Date(),
      })
      .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.id, before.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.hs_code.update",
      entityType: "hs_code",
      entityId: before.id,
      details: {
        code: before.code,
        before: { wording: before.wording, tecRate: before.tecRate },
        after: { wording: input.data.wording, tecRate: input.data.tecRate },
      },
    });
  });
}

/** ART-023 — un code cité par un article, une ligne de déclaration ou portant des enfants ne se supprime pas. */
export async function deleteHsCode(
  db: Database,
  input: { tenantId: string; actorUserId: string; hsCodeId: string },
): Promise<void> {
  const references = await hsCodeUsageReferences(db, input.tenantId, [input.hsCodeId]);
  const cited = references.get(input.hsCodeId) ?? [];
  if (cited.length > 0) {
    const [row] = await db
      .select({ code: hsCodes.code, wording: hsCodes.wording })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.id, input.hsCodeId)))
      .limit(1);
    throw new CatalogError(
      `${row?.code ?? "?"} ${row?.wording ?? ""} : référencé par ${cited.join(", ")}, la suppression est refusée.`,
    );
  }

  await db.transaction(async (tx) => {
    const before = await lockHsCode(tx, input.tenantId, input.hsCodeId);
    await tx
      .delete(hsCodes)
      .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.hs_code.delete",
      entityType: "hs_code",
      entityId: before.id,
      details: { code: before.code, wording: before.wording },
    });
  });
}
