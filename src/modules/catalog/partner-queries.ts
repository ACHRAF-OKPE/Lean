import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { type Database } from "@/db/client";
import {
  articleSupplyPolicies,
  auditEvents,
  customsDeclarations,
  invoices,
  journalEntryLines,
  partnerCategories,
  partnerCategoryLinks,
  partners,
  purchaseOrders,
  salesOrders,
  stockMoves,
  supplyRunLines,
  tenderAwards,
  tenderInvitations,
  tenderQuotes,
} from "@/db/schema";
import { planPartnerBulk } from "./bulk";
import { CatalogError } from "./errors";
import { categoryTitleErrors, normalizeCategoryTitle, planCategoryDelete } from "./categories";
import type { PartnerEditData } from "./partner-edit";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PartnerCategory {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly partnerCount: number;
}

const CATEGORY_COUNTS = sql<number>`count(${partnerCategoryLinks.id})::int`;

/** ART-008 — les catégories de l'espace, avec le volume de tiers qu'elles portent. */
export async function listPartnerCategories(
  db: Database,
  tenantId: string,
): Promise<PartnerCategory[]> {
  const rows = await db
    .select({
      id: partnerCategories.id,
      title: partnerCategories.title,
      active: partnerCategories.active,
      partnerCount: CATEGORY_COUNTS,
    })
    .from(partnerCategories)
    .leftJoin(
      partnerCategoryLinks,
      and(
        eq(partnerCategoryLinks.tenantId, partnerCategories.tenantId),
        eq(partnerCategoryLinks.categoryId, partnerCategories.id),
      ),
    )
    .where(eq(partnerCategories.tenantId, tenantId))
    .groupBy(partnerCategories.id)
    .orderBy(asc(partnerCategories.title));

  return rows.map((row) => ({ ...row, partnerCount: Number(row.partnerCount) }));
}

export async function createCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; title: string },
): Promise<PartnerCategory> {
  const title = normalizeCategoryTitle(input.title);
  const errors = categoryTitleErrors(title);
  if (errors.length > 0) {
    throw new CatalogError(errors[0]!);
  }

  try {
    const [created] = await db
      .insert(partnerCategories)
      .values({ tenantId: input.tenantId, title })
      .returning({ id: partnerCategories.id, title: partnerCategories.title });

    if (!created) {
      throw new CatalogError("La catégorie n'a pas pu être créée.");
    }

    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.category.create",
      entityType: "partner_category",
      entityId: created.id,
      details: { title: created.title },
    });

    return { id: created.id, title: created.title, active: true, partnerCount: 0 };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CatalogError(`La catégorie « ${title} » existe déjà dans cet espace.`);
    }
    throw error;
  }
}

/** GEN-015 — le titre tapé dans le champ de référence : on retrouve la catégorie existante ou on la crée. */
export async function resolveCategoryIds(
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
      .select({ id: partnerCategories.id })
      .from(partnerCategories)
      .where(
        and(
          eq(partnerCategories.tenantId, input.tenantId),
          sql`lower(${partnerCategories.title}) = lower(${title})`,
        ),
      )
      .limit(1);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await createCategory(db, { ...input, title });
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

export async function renameCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string; title: string },
): Promise<void> {
  const title = normalizeCategoryTitle(input.title);
  const errors = categoryTitleErrors(title);
  if (errors.length > 0) {
    throw new CatalogError(errors[0]!);
  }

  await db.transaction(async (tx) => {
    const before = await lockCategory(tx, input.tenantId, input.categoryId);
    await tx
      .update(partnerCategories)
      .set({ title, updatedAt: new Date() })
      .where(
        and(eq(partnerCategories.tenantId, input.tenantId), eq(partnerCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.category.update",
      entityType: "partner_category",
      entityId: before.id,
      details: { before: { title: before.title }, after: { title } },
    });
  });
}

/** ART-008 — activer ou désactiver une catégorie ; la désactivation se trace comme une modification. */
export async function setCategoryActive(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string; active: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockCategory(tx, input.tenantId, input.categoryId);
    await tx
      .update(partnerCategories)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(partnerCategories.tenantId, input.tenantId), eq(partnerCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.category.update",
      entityType: "partner_category",
      entityId: before.id,
      details: { code: before.title, before: before.active, after: input.active },
    });
  });
}

/** ART-008 — une catégorie portée ne se supprime pas : le refus est écrit avant toute écriture. */
export async function deleteCategory(
  db: Database,
  input: { tenantId: string; actorUserId: string; categoryId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockCategory(tx, input.tenantId, input.categoryId);
    const [counted] = await tx
      .select({ value: count() })
      .from(partnerCategoryLinks)
      .where(
        and(
          eq(partnerCategoryLinks.tenantId, input.tenantId),
          eq(partnerCategoryLinks.categoryId, before.id),
        ),
      );

    const plan = planCategoryDelete({
      title: before.title,
      count: counted?.value ?? 0,
      subject: "tier(s)",
    });
    if (!plan.ok) {
      throw new CatalogError(plan.error);
    }

    await tx
      .delete(partnerCategories)
      .where(
        and(eq(partnerCategories.tenantId, input.tenantId), eq(partnerCategories.id, before.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.category.delete",
      entityType: "partner_category",
      entityId: before.id,
      details: { before: { title: before.title }, after: null },
    });
  });
}

/** Les catégories portées par une page de tiers, pour la liste, le Kanban et la fiche. */
export async function categoriesByPartner(
  db: Database,
  tenantId: string,
  partnerIds: readonly string[],
): Promise<Map<string, { id: string; title: string }[]>> {
  const map = new Map<string, { id: string; title: string }[]>();
  if (partnerIds.length === 0) {
    return map;
  }

  const rows = await db
    .select({
      partnerId: partnerCategoryLinks.partnerId,
      id: partnerCategories.id,
      title: partnerCategories.title,
    })
    .from(partnerCategoryLinks)
    .innerJoin(
      partnerCategories,
      and(
        eq(partnerCategories.tenantId, partnerCategoryLinks.tenantId),
        eq(partnerCategories.id, partnerCategoryLinks.categoryId),
      ),
    )
    .where(
      and(
        eq(partnerCategoryLinks.tenantId, tenantId),
        inArray(partnerCategoryLinks.partnerId, [...partnerIds]),
      ),
    )
    .orderBy(asc(partnerCategories.title));

  for (const row of rows) {
    const list = map.get(row.partnerId) ?? [];
    list.push({ id: row.id, title: row.title });
    map.set(row.partnerId, list);
  }
  return map;
}

/** Les identifiants des tiers portant l'une des catégories demandées. */
export async function partnerIdsByCategories(
  db: Database,
  tenantId: string,
  categoryIds: readonly string[],
): Promise<string[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ partnerId: partnerCategoryLinks.partnerId })
    .from(partnerCategoryLinks)
    .where(
      and(
        eq(partnerCategoryLinks.tenantId, tenantId),
        inArray(partnerCategoryLinks.categoryId, [...categoryIds]),
      ),
    );
  return [...new Set(rows.map((row) => row.partnerId))];
}

/** ART-008 — le rattachement se remplace en bloc : la fiche garde exactement les catégories choisies. */
export async function replacePartnerCategories(
  tx: Transaction,
  input: { tenantId: string; partnerId: string; categoryIds: readonly string[] },
): Promise<void> {
  await tx
    .delete(partnerCategoryLinks)
    .where(
      and(
        eq(partnerCategoryLinks.tenantId, input.tenantId),
        eq(partnerCategoryLinks.partnerId, input.partnerId),
      ),
    );

  for (const categoryId of [...new Set(input.categoryIds)]) {
    const [known] = await tx
      .select({ id: partnerCategories.id })
      .from(partnerCategories)
      .where(
        and(eq(partnerCategories.tenantId, input.tenantId), eq(partnerCategories.id, categoryId)),
      )
      .limit(1);
    if (!known) {
      throw new CatalogError("Une catégorie rattachée au tiers est inconnue dans cet espace.");
    }
    await tx.insert(partnerCategoryLinks).values({
      tenantId: input.tenantId,
      partnerId: input.partnerId,
      categoryId,
    });
  }
}

/**
 * ART-011 / GEN-017 — un tiers référencé par des documents ne se supprime pas : la liste des
 * documents qui le citent formule le refus, ligne par ligne.
 */
export async function partnerDocumentReferences(
  db: Database,
  tenantId: string,
  partnerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const targets = [...new Set(partnerIds)];
  const result = new Map<string, string[]>();
  if (targets.length === 0) {
    return result;
  }

  const sources: readonly {
    readonly label: string;
    readonly rows: () => Promise<{ partnerId: string | null; value: number }[]>;
  }[] = [
    {
      label: "commandes d'achat",
      rows: () =>
        db
          .select({ partnerId: purchaseOrders.supplierId, value: count() })
          .from(purchaseOrders)
          .where(
            and(eq(purchaseOrders.tenantId, tenantId), inArray(purchaseOrders.supplierId, targets)),
          )
          .groupBy(purchaseOrders.supplierId),
    },
    {
      label: "commandes de vente",
      rows: () =>
        db
          .select({ partnerId: salesOrders.customerId, value: count() })
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), inArray(salesOrders.customerId, targets)))
          .groupBy(salesOrders.customerId),
    },
    {
      label: "factures",
      rows: () =>
        db
          .select({ partnerId: invoices.customerId, value: count() })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.customerId, targets)))
          .groupBy(invoices.customerId),
    },
    {
      label: "mouvements de stock",
      rows: () =>
        db
          .select({ partnerId: stockMoves.partnerId, value: count() })
          .from(stockMoves)
          .where(and(eq(stockMoves.tenantId, tenantId), inArray(stockMoves.partnerId, targets)))
          .groupBy(stockMoves.partnerId),
    },
    {
      label: "déclarations douanières",
      rows: () =>
        db
          .select({ partnerId: customsDeclarations.partnerId, value: count() })
          .from(customsDeclarations)
          .where(
            and(
              eq(customsDeclarations.tenantId, tenantId),
              inArray(customsDeclarations.partnerId, targets),
            ),
          )
          .groupBy(customsDeclarations.partnerId),
    },
    {
      label: "écritures comptables",
      rows: () =>
        db
          .select({ partnerId: journalEntryLines.partnerId, value: count() })
          .from(journalEntryLines)
          .where(
            and(
              eq(journalEntryLines.tenantId, tenantId),
              inArray(journalEntryLines.partnerId, targets),
            ),
          )
          .groupBy(journalEntryLines.partnerId),
    },
    {
      label: "invitations d'appels d'offres",
      rows: () =>
        db
          .select({ partnerId: tenderInvitations.supplierId, value: count() })
          .from(tenderInvitations)
          .where(
            and(
              eq(tenderInvitations.tenantId, tenantId),
              inArray(tenderInvitations.supplierId, targets),
            ),
          )
          .groupBy(tenderInvitations.supplierId),
    },
    {
      label: "cotations",
      rows: () =>
        db
          .select({ partnerId: tenderQuotes.supplierId, value: count() })
          .from(tenderQuotes)
          .where(
            and(eq(tenderQuotes.tenantId, tenantId), inArray(tenderQuotes.supplierId, targets)),
          )
          .groupBy(tenderQuotes.supplierId),
    },
    {
      label: "attributions",
      rows: () =>
        db
          .select({ partnerId: tenderAwards.supplierId, value: count() })
          .from(tenderAwards)
          .where(
            and(eq(tenderAwards.tenantId, tenantId), inArray(tenderAwards.supplierId, targets)),
          )
          .groupBy(tenderAwards.supplierId),
    },
    {
      label: "besoins",
      rows: () =>
        db
          .select({ partnerId: supplyRunLines.supplierId, value: count() })
          .from(supplyRunLines)
          .where(
            and(eq(supplyRunLines.tenantId, tenantId), inArray(supplyRunLines.supplierId, targets)),
          )
          .groupBy(supplyRunLines.supplierId),
    },
    {
      label: "politiques d'approvisionnement",
      rows: () =>
        db
          .select({ partnerId: articleSupplyPolicies.supplierId, value: count() })
          .from(articleSupplyPolicies)
          .where(
            and(
              eq(articleSupplyPolicies.tenantId, tenantId),
              inArray(articleSupplyPolicies.supplierId, targets),
            ),
          )
          .groupBy(articleSupplyPolicies.supplierId),
    },
  ];

  for (const source of sources) {
    for (const row of await source.rows()) {
      if (row.partnerId === null || row.value === 0) {
        continue;
      }
      const list = result.get(row.partnerId) ?? [];
      list.push(`${source.label} (${row.value})`);
      result.set(row.partnerId, list);
    }
  }

  return result;
}

async function lockCategory(
  tx: Transaction,
  tenantId: string,
  categoryId: string,
): Promise<{ id: string; title: string; active: boolean }> {
  const [row] = await tx
    .select({
      id: partnerCategories.id,
      title: partnerCategories.title,
      active: partnerCategories.active,
    })
    .from(partnerCategories)
    .where(and(eq(partnerCategories.tenantId, tenantId), eq(partnerCategories.id, categoryId)))
    .for("update")
    .limit(1);

  if (!row) {
    throw new CatalogError("Catégorie introuvable dans cet espace de travail.");
  }
  return row;
}

export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/** GEN-013 — la fiche se corrige ligne à ligne ; le couple rôles/actif garde les gardes de création. */
export async function updatePartner(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    partnerId: string;
    data: PartnerEditData;
    categoryIds: readonly string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockPartner(tx, input.tenantId, input.partnerId);
    const after = input.data;

    await tx
      .update(partners)
      .set({
        name: after.name,
        type: after.type,
        isCustomer: after.isCustomer,
        isSupplier: after.isSupplier,
        email: after.email,
        phone: after.phone,
        addressLine: after.addressLine,
        city: after.city,
        countryCode: after.countryCode,
        taxNumber: after.taxNumber,
        paymentTermDays: after.paymentTermDays,
        latitude: after.latitude,
        longitude: after.longitude,
        active: after.active,
        updatedAt: new Date(),
      })
      .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, before.id)));

    await replacePartnerCategories(tx, {
      tenantId: input.tenantId,
      partnerId: before.id,
      categoryIds: input.categoryIds,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.update",
      entityType: "partner",
      entityId: before.id,
      details: {
        code: before.code,
        before: {
          name: before.name,
          isCustomer: before.isCustomer,
          isSupplier: before.isSupplier,
          active: before.active,
          latitude: before.latitude,
          longitude: before.longitude,
        },
        after: {
          name: after.name,
          isCustomer: after.isCustomer,
          isSupplier: after.isSupplier,
          active: after.active,
          latitude: after.latitude,
          longitude: after.longitude,
        },
      },
    });
  });
}

/** GEN-017 — une sélection se supprime en une transaction, ou pas du tout. */
export async function deletePartners(
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
    throw new CatalogError("Aucun tiers sélectionné.");
  }

  const [rows, references] = await Promise.all([
    db
      .select({ id: partners.id, code: partners.code, name: partners.name })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, ids))),
    partnerDocumentReferences(db, input.tenantId, ids),
  ]);

  if (rows.length !== ids.length) {
    throw new CatalogError("Un tiers de la sélection est introuvable dans cet espace.");
  }

  const plan = planPartnerBulk({
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
      const before = await lockPartner(tx, input.tenantId, id);
      await tx
        .delete(partners)
        .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, before.id)));
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.partner.delete",
        entityType: "partner",
        entityId: before.id,
        details: { code: before.code, before: { name: before.name }, after: null },
      });
    }
  });
}

/** GEN-017 — la suppression passe par le plan : un tiers référencé ne part pas, et le refus est nommé. */
export async function deletePartner(
  db: Database,
  input: { tenantId: string; actorUserId: string; partnerId: string },
): Promise<void> {
  const references = await partnerDocumentReferences(db, input.tenantId, [input.partnerId]);
  const cited = references.get(input.partnerId) ?? [];
  if (cited.length > 0) {
    const [partner] = await db
      .select({ code: partners.code, name: partners.name })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, input.partnerId)))
      .limit(1);
    throw new CatalogError(
      `${partner?.code ?? "?"} · ${partner?.name ?? "?"} : rattaché à ${cited.join(", ")}, la suppression est refusée.`,
    );
  }

  await db.transaction(async (tx) => {
    const before = await lockPartner(tx, input.tenantId, input.partnerId);
    await tx
      .delete(partners)
      .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.delete",
      entityType: "partner",
      entityId: before.id,
      details: { code: before.code, before: { name: before.name }, after: null },
    });
  });
}

export interface PartnerBulkPatch {
  readonly addRole?: "client" | "fournisseur";
  readonly active?: boolean;
  readonly categoryIds?: readonly string[];
}

/** GEN-017 — une sélection, une transaction, un événement d'audit par ligne : rien n'est à moitié écrit. */
export async function applyPartnerBulk(
  db: Database,
  input: { tenantId: string; actorUserId: string; ids: readonly string[]; patch: PartnerBulkPatch },
): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    throw new CatalogError("Aucun tiers sélectionné.");
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        isCustomer: partners.isCustomer,
        isSupplier: partners.isSupplier,
        active: partners.active,
      })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, ids)))
      .for("update");

    if (rows.length !== ids.length) {
      throw new CatalogError("Un tiers de la sélection est introuvable dans cet espace.");
    }

    for (const row of rows) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.patch.addRole === "client") set.isCustomer = true;
      if (input.patch.addRole === "fournisseur") set.isSupplier = true;
      if (input.patch.active !== undefined) set.active = input.patch.active;

      await tx
        .update(partners)
        .set(set)
        .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, row.id)));

      if (input.patch.categoryIds !== undefined) {
        await replacePartnerCategories(tx, {
          tenantId: input.tenantId,
          partnerId: row.id,
          categoryIds: input.patch.categoryIds,
        });
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "catalog.partner.bulk",
        entityType: "partner",
        entityId: row.id,
        details: {
          code: row.code,
          before: {
            isCustomer: row.isCustomer,
            isSupplier: row.isSupplier,
            active: row.active,
          },
          after: {
            isCustomer: input.patch.addRole === "client" ? true : row.isCustomer,
            isSupplier: input.patch.addRole === "fournisseur" ? true : row.isSupplier,
            active: input.patch.active ?? row.active,
            categories: input.patch.categoryIds?.length ?? null,
          },
        },
      });
    }
  });
}

async function lockPartner(
  tx: Transaction,
  tenantId: string,
  partnerId: string,
): Promise<{
  id: string;
  code: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  active: boolean;
  latitude: string | null;
  longitude: string | null;
}> {
  const [row] = await tx
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      isCustomer: partners.isCustomer,
      isSupplier: partners.isSupplier,
      active: partners.active,
      latitude: partners.latitude,
      longitude: partners.longitude,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, partnerId)))
    .for("update")
    .limit(1);

  if (!row) {
    throw new CatalogError("Tiers introuvable dans cet espace de travail.");
  }
  return row;
}

/**
 * ART-016 — le glisser-déposer d'une carte de Kanban rattache le tiers à une catégorie ; déposée sur
 * « Sans catégorie », la carte détache le tiers de toutes ses catégories.
 */
export async function movePartnerToCategory(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    partnerId: string;
    categoryId: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockPartner(tx, input.tenantId, input.partnerId);
    const previous = await tx
      .select({ categoryId: partnerCategoryLinks.categoryId })
      .from(partnerCategoryLinks)
      .where(
        and(
          eq(partnerCategoryLinks.tenantId, input.tenantId),
          eq(partnerCategoryLinks.partnerId, before.id),
        ),
      );

    await replacePartnerCategories(tx, {
      tenantId: input.tenantId,
      partnerId: before.id,
      categoryIds: input.categoryId ? [input.categoryId] : [],
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.category",
      entityType: "partner",
      entityId: before.id,
      details: {
        code: before.code,
        before: { categories: previous.map((row) => row.categoryId) },
        after: { categories: input.categoryId ? [input.categoryId] : [] },
      },
    });
  });
}
