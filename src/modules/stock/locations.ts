import { and, asc, count, countDistinct, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  stockLevels,
  stockLocations,
  stockMoveLines,
  stockMoves,
  stockSettings,
  type StockLocationType,
} from "@/db/schema";
import { normalizeQuantity } from "./quantities";
import { StockError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const DEFAULT_INTERNAL_CODE = "MAG";
export const DEFAULT_SUPPLIER_CODE = "FOURN";
export const DEFAULT_CUSTOMER_CODE = "CLIENT";
export const DEFAULT_INVENTORY_CODE = "INVENT";

export interface DefaultLocations {
  readonly internalId: string;
  readonly supplierId: string;
  readonly customerId: string;
  readonly inventoryId: string;
}

export interface LocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export async function ensureDefaultLocations(
  tx: Transaction,
  tenantId: string,
): Promise<DefaultLocations> {
  await tx
    .insert(stockLocations)
    .values([
      { tenantId, code: DEFAULT_INTERNAL_CODE, name: "Magasin principal", type: "internal" },
      {
        tenantId,
        code: DEFAULT_SUPPLIER_CODE,
        name: "Fournisseur (virtuel)",
        type: "supplier",
      },
      {
        tenantId,
        code: DEFAULT_CUSTOMER_CODE,
        name: "Client (virtuel)",
        type: "customer",
      },
      {
        tenantId,
        code: DEFAULT_INVENTORY_CODE,
        name: "Ajustement d'inventaire (virtuel)",
        type: "inventory",
      },
    ])
    .onConflictDoNothing({ target: [stockLocations.tenantId, stockLocations.code] });

  const rows = await tx
    .select({
      id: stockLocations.id,
      code: stockLocations.code,
      type: stockLocations.type,
    })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        inArray(stockLocations.code, [
          DEFAULT_INTERNAL_CODE,
          DEFAULT_SUPPLIER_CODE,
          DEFAULT_CUSTOMER_CODE,
          DEFAULT_INVENTORY_CODE,
        ]),
      ),
    );

  const internal = rows.find((row) => row.code === DEFAULT_INTERNAL_CODE);
  const supplier = rows.find((row) => row.code === DEFAULT_SUPPLIER_CODE);
  const customer = rows.find((row) => row.code === DEFAULT_CUSTOMER_CODE);
  const inventory = rows.find((row) => row.code === DEFAULT_INVENTORY_CODE);
  if (
    !internal ||
    !supplier ||
    !customer ||
    !inventory ||
    internal.type !== "internal" ||
    supplier.type !== "supplier" ||
    customer.type !== "customer" ||
    inventory.type !== "inventory"
  ) {
    throw new StockError(
      "Les emplacements par défaut MAG, FOURN, CLIENT et INVENT sont introuvables.",
    );
  }

  return {
    internalId: internal.id,
    supplierId: supplier.id,
    customerId: customer.id,
    inventoryId: inventory.id,
  };
}

export async function listInternalLocations(
  db: Database,
  tenantId: string,
): Promise<readonly LocationOption[]> {
  await db.transaction(async (tx) => {
    await ensureDefaultLocations(tx, tenantId);
  });

  return db
    .select({ id: stockLocations.id, code: stockLocations.code, name: stockLocations.name })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        eq(stockLocations.type, "internal"),
        eq(stockLocations.active, true),
      ),
    )
    .orderBy(asc(stockLocations.code));
}

/* ------------------------------------------------------------- registre des magasins */

export interface StockLocationView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: StockLocationType;
  readonly active: boolean;
  readonly articleCount: number;
  readonly totalQuantity: string;
  readonly moveCount: number;
  readonly createdAt: Date;
}

export interface StockLocationDetail extends StockLocationView {
  readonly levels: readonly {
    readonly articleCode: string;
    readonly articleName: string;
    readonly unitCode: string;
    readonly quantity: string;
  }[];
  readonly moves: readonly {
    readonly id: string;
    readonly number: string;
    readonly realDate: string;
    readonly direction: "in" | "out";
    readonly counterpartCode: string;
    readonly articleCode: string;
    readonly articleName: string;
    readonly qty: string;
    readonly unitCode: string;
  }[];
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

function validateCode(code: string): void {
  if (!CODE_PATTERN.test(code)) {
    throw new StockError(
      "Code du magasin : 2 à 12 caractères, lettres majuscules, chiffres et tirets, commençant par une lettre ou un chiffre.",
    );
  }
}

function validateName(name: string): void {
  if (name.length === 0 || name.length > 80) {
    throw new StockError("Nom du magasin : 1 à 80 caractères.");
  }
}

async function locationMetrics(
  db: Database,
  tenantId: string,
): Promise<Map<string, { articleCount: number; totalQuantity: string; moveCount: number }>> {
  const [levelRows, fromRows, toRows] = await Promise.all([
    db
      .select({
        locationId: stockLevels.locationId,
        articleCount: countDistinct(stockLevels.articleId),
        totalQuantity: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)::text`,
      })
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, tenantId), sql`${stockLevels.quantity} > 0`))
      .groupBy(stockLevels.locationId),
    db
      .select({ locationId: stockMoves.fromLocationId, value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, tenantId))
      .groupBy(stockMoves.fromLocationId),
    db
      .select({ locationId: stockMoves.toLocationId, value: count() })
      .from(stockMoves)
      .where(eq(stockMoves.tenantId, tenantId))
      .groupBy(stockMoves.toLocationId),
  ]);

  const metrics = new Map<
    string,
    { articleCount: number; totalQuantity: string; moveCount: number }
  >();
  const ensure = (locationId: string) => {
    let entry = metrics.get(locationId);
    if (!entry) {
      entry = { articleCount: 0, totalQuantity: "0", moveCount: 0 };
      metrics.set(locationId, entry);
    }
    return entry;
  };
  for (const row of levelRows) {
    const entry = ensure(row.locationId);
    entry.articleCount = row.articleCount;
    entry.totalQuantity = normalizeQuantity(row.totalQuantity);
  }
  for (const row of fromRows) {
    ensure(row.locationId).moveCount += row.value;
  }
  for (const row of toRows) {
    ensure(row.locationId).moveCount += row.value;
  }
  return metrics;
}

/** STK-005 — le registre des magasins compte articles, quantité et mouvements, actifs compris. */
export async function listStockLocations(
  db: Database,
  tenantId: string,
): Promise<readonly StockLocationView[]> {
  await db.transaction(async (tx) => {
    await ensureDefaultLocations(tx, tenantId);
  });

  const [rows, metrics] = await Promise.all([
    db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.type, "internal")))
      .orderBy(asc(stockLocations.code)),
    locationMetrics(db, tenantId),
  ]);

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    active: row.active,
    articleCount: metrics.get(row.id)?.articleCount ?? 0,
    totalQuantity: metrics.get(row.id)?.totalQuantity ?? "0",
    moveCount: metrics.get(row.id)?.moveCount ?? 0,
    createdAt: row.createdAt,
  }));
}

export async function getStockLocationDetail(
  db: Database,
  tenantId: string,
  locationId: string,
): Promise<StockLocationDetail | null> {
  const [row] = await db
    .select()
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        eq(stockLocations.id, locationId),
        eq(stockLocations.type, "internal"),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  const fromLocation = alias(stockLocations, "from_location");
  const toLocation = alias(stockLocations, "to_location");

  const [levels, moveRows, metrics] = await Promise.all([
    db
      .select({
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        quantity: stockLevels.quantity,
      })
      .from(stockLevels)
      .innerJoin(
        articles,
        and(eq(articles.tenantId, stockLevels.tenantId), eq(articles.id, stockLevels.articleId)),
      )
      .where(
        and(
          eq(stockLevels.tenantId, tenantId),
          eq(stockLevels.locationId, locationId),
          sql`${stockLevels.quantity} > 0`,
        ),
      )
      .orderBy(asc(articles.name)),
    db
      .select({
        id: stockMoves.id,
        number: stockMoves.number,
        realDate: stockMoves.realDate,
        fromLocationId: stockMoves.fromLocationId,
        toLocationId: stockMoves.toLocationId,
        fromCode: fromLocation.code,
        toCode: toLocation.code,
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        qty: stockMoveLines.qty,
      })
      .from(stockMoves)
      .innerJoin(
        stockMoveLines,
        and(
          eq(stockMoveLines.tenantId, stockMoves.tenantId),
          eq(stockMoveLines.moveId, stockMoves.id),
        ),
      )
      .innerJoin(
        articles,
        and(
          eq(articles.tenantId, stockMoveLines.tenantId),
          eq(articles.id, stockMoveLines.articleId),
        ),
      )
      .leftJoin(
        fromLocation,
        and(
          eq(fromLocation.tenantId, stockMoves.tenantId),
          eq(fromLocation.id, stockMoves.fromLocationId),
        ),
      )
      .leftJoin(
        toLocation,
        and(
          eq(toLocation.tenantId, stockMoves.tenantId),
          eq(toLocation.id, stockMoves.toLocationId),
        ),
      )
      .where(
        and(
          eq(stockMoves.tenantId, tenantId),
          sql`(${stockMoves.fromLocationId} = ${locationId} or ${stockMoves.toLocationId} = ${locationId})`,
        ),
      )
      .orderBy(desc(stockMoves.createdAt), asc(stockMoveLines.lineNumber))
      .limit(40),
    locationMetrics(db, tenantId),
  ]);

  const metric = metrics.get(locationId);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    active: row.active,
    articleCount: metric?.articleCount ?? 0,
    totalQuantity: metric?.totalQuantity ?? "0",
    moveCount: metric?.moveCount ?? 0,
    createdAt: row.createdAt,
    levels: levels.map((level) => ({ ...level, quantity: normalizeQuantity(level.quantity) })),
    moves: moveRows.map((move) => {
      const incoming = move.toLocationId === locationId;
      return {
        id: move.id,
        number: move.number,
        realDate: move.realDate,
        direction: incoming ? ("in" as const) : ("out" as const),
        counterpartCode: (incoming ? move.fromCode : move.toCode) ?? "",
        articleCode: move.articleCode,
        articleName: move.articleName,
        unitCode: move.unitCode,
        qty: normalizeQuantity(move.qty),
      };
    }),
  };
}

/* --------------------------------------------------------------- écritures magasins */

export interface CreateStockLocationInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: { readonly code: unknown; readonly name: unknown };
}

/** STK-005 — un magasin se crée actif, code unique dans l'espace. */
export async function createStockLocation(
  db: Database,
  input: CreateStockLocationInput,
): Promise<{ id: string }> {
  const code = normalizeCode(input.raw.code);
  const name = String(input.raw.name ?? "").trim();
  validateCode(code);
  validateName(name);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, input.tenantId), eq(stockLocations.code, code)))
      .limit(1);
    if (existing) {
      throw new StockError(`Le code ${code} est déjà utilisé par un autre emplacement.`);
    }

    const [created] = await tx
      .insert(stockLocations)
      .values({ tenantId: input.tenantId, code, name, type: "internal" })
      .returning({ id: stockLocations.id });
    if (!created) {
      throw new StockError("Le magasin n'a pas pu être créé.");
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.location.create",
      entityType: "stock_locations",
      entityId: created.id,
      details: { code, name },
    });

    return { id: created.id };
  });
}

export interface UpdateStockLocationInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly locationId: string;
  readonly raw: { readonly name: unknown };
}

/** STK-005 — le code d'un magasin est immuable : seul le libellé se corrige. */
export async function updateStockLocation(
  db: Database,
  input: UpdateStockLocationInput,
): Promise<void> {
  const name = String(input.raw.name ?? "").trim();
  validateName(name);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: stockLocations.id, code: stockLocations.code, name: stockLocations.name })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.tenantId, input.tenantId),
          eq(stockLocations.id, input.locationId),
          eq(stockLocations.type, "internal"),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new StockError("Magasin introuvable dans cet espace.");
    }

    await tx
      .update(stockLocations)
      .set({ name, updatedAt: new Date() })
      .where(
        and(eq(stockLocations.tenantId, input.tenantId), eq(stockLocations.id, input.locationId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.location.update",
      entityType: "stock_locations",
      entityId: input.locationId,
      details: { code: existing.code, before: existing.name, after: name },
    });
  });
}

export interface SetStockLocationActiveInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly locationId: string;
  readonly active: boolean;
}

/** STK-006 — un magasin qui porte du stock, sert de magasin par défaut ou reste le dernier actif ne se désactive pas. */
export async function setStockLocationActive(
  db: Database,
  input: SetStockLocationActiveInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [location] = await tx
      .select({ id: stockLocations.id, code: stockLocations.code, active: stockLocations.active })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.tenantId, input.tenantId),
          eq(stockLocations.id, input.locationId),
          eq(stockLocations.type, "internal"),
        ),
      )
      .limit(1);
    if (!location) {
      throw new StockError("Magasin introuvable dans cet espace.");
    }
    if (location.active === input.active) {
      return;
    }

    if (!input.active) {
      await assertLocationDeactivatable(tx, input.tenantId, location.id, location.code);
    }

    await tx
      .update(stockLocations)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(stockLocations.tenantId, input.tenantId), eq(stockLocations.id, input.locationId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.active ? "stock.location.activate" : "stock.location.deactivate",
      entityType: "stock_locations",
      entityId: input.locationId,
      details: { code: location.code },
    });
  });
}

async function assertLocationDeactivatable(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  code: string,
): Promise<void> {
  const [settingsRow] = await tx
    .select({ id: stockSettings.id })
    .from(stockSettings)
    .where(
      and(
        eq(stockSettings.tenantId, tenantId),
        eq(stockSettings.defaultInternalLocationId, locationId),
      ),
    )
    .limit(1);
  if (settingsRow) {
    throw new StockError(
      `Le magasin ${code} est le magasin par défaut : changez ce réglage avant de le désactiver.`,
    );
  }

  const [stockRow] = await tx
    .select({ id: stockLevels.id, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLevels.locationId, locationId),
        sql`${stockLevels.quantity} <> 0`,
      ),
    )
    .limit(1);
  if (stockRow) {
    throw new StockError(
      `Le magasin ${code} porte encore du stock : transférez ou ajustez les articles avant de le désactiver.`,
    );
  }

  const [remaining] = await tx
    .select({ id: stockLocations.id })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        eq(stockLocations.type, "internal"),
        eq(stockLocations.active, true),
        ne(stockLocations.id, locationId),
      ),
    )
    .limit(1);
  if (!remaining) {
    throw new StockError(
      `Le magasin ${code} est le dernier magasin actif : créez-en un autre avant de le désactiver.`,
    );
  }
}
