import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import {
  articles,
  stockLevels,
  stockLocations,
  stockMoveLines,
  stockMoves,
  type StockMoveType,
} from "@/db/schema";
import type { StockFilters } from "./filters";
import { computeLineTotal, normalizeQuantity } from "./quantities";

export interface StockLevelView {
  readonly locationCode: string;
  readonly locationName: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly quantity: string;
}

export interface StockMovementView {
  readonly id: string;
  readonly number: string;
  readonly type: StockMoveType;
  readonly realDate: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly cancelsMoveId: string | null;
  readonly createdAt: Date;
}

export interface StockOverview {
  readonly levels: readonly StockLevelView[];
  readonly moves: readonly StockMovementView[];
}

export interface StockCounts {
  readonly stockedArticles: number;
  readonly moves: number;
}

export async function getStockCounts(db: Database, tenantId: string): Promise<StockCounts> {
  const [[levelRow], [moveRow]] = await Promise.all([
    db
      .select({ value: countDistinct(stockLevels.articleId) })
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, tenantId), sql`${stockLevels.quantity} > 0`)),
    db.select({ value: count() }).from(stockMoves).where(eq(stockMoves.tenantId, tenantId)),
  ]);

  return {
    stockedArticles: levelRow?.value ?? 0,
    moves: moveRow?.value ?? 0,
  };
}

export async function getStockOverview(db: Database, tenantId: string): Promise<StockOverview> {
  const fromLocation = alias(stockLocations, "from_location");
  const toLocation = alias(stockLocations, "to_location");

  const [levels, moves] = await Promise.all([
    db
      .select({
        locationCode: stockLocations.code,
        locationName: stockLocations.name,
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        quantity: stockLevels.quantity,
      })
      .from(stockLevels)
      .innerJoin(
        stockLocations,
        and(
          eq(stockLocations.tenantId, stockLevels.tenantId),
          eq(stockLocations.id, stockLevels.locationId),
        ),
      )
      .innerJoin(
        articles,
        and(eq(articles.tenantId, stockLevels.tenantId), eq(articles.id, stockLevels.articleId)),
      )
      .where(
        and(
          eq(stockLevels.tenantId, tenantId),
          eq(stockLocations.type, "internal"),
          sql`${stockLevels.quantity} > 0`,
        ),
      )
      .orderBy(asc(stockLocations.code), asc(articles.name))
      .limit(500),
    db
      .select({
        id: stockMoves.id,
        number: stockMoves.number,
        type: stockMoves.type,
        realDate: stockMoves.realDate,
        fromCode: fromLocation.code,
        toCode: toLocation.code,
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        qty: stockMoveLines.qty,
        cancelsMoveId: stockMoves.cancelsMoveId,
        createdAt: stockMoves.createdAt,
      })
      .from(stockMoveLines)
      .innerJoin(
        stockMoves,
        and(
          eq(stockMoves.tenantId, stockMoveLines.tenantId),
          eq(stockMoves.id, stockMoveLines.moveId),
        ),
      )
      .innerJoin(
        articles,
        and(
          eq(articles.tenantId, stockMoveLines.tenantId),
          eq(articles.id, stockMoveLines.articleId),
        ),
      )
      .innerJoin(
        fromLocation,
        and(
          eq(fromLocation.tenantId, stockMoves.tenantId),
          eq(fromLocation.id, stockMoves.fromLocationId),
        ),
      )
      .innerJoin(
        toLocation,
        and(
          eq(toLocation.tenantId, stockMoves.tenantId),
          eq(toLocation.id, stockMoves.toLocationId),
        ),
      )
      .where(eq(stockMoveLines.tenantId, tenantId))
      .orderBy(desc(stockMoves.createdAt), asc(stockMoveLines.lineNumber))
      .limit(200),
  ]);

  return {
    levels: levels.map((level) => ({ ...level, quantity: normalizeQuantity(level.quantity) })),
    moves: moves.map((move) => ({ ...move, qty: normalizeQuantity(move.qty) })),
  };
}

/* ------------------------------------------------------- registre filtré (STK-009) */

export const STOCK_MOVE_LIMIT = 200;

export interface StockMoveLineEntry {
  readonly moveId: string;
  readonly lineNumber: number;
  readonly number: string;
  readonly type: StockMoveType;
  readonly realDate: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly notes: string | null;
  readonly cancelsMoveId: string | null;
  /** STK-002 — un mouvement rattaché à un document ne s'annule que par son document source. */
  readonly cancellable: boolean;
  readonly createdAt: Date;
}

export interface StockMovePage {
  readonly rows: readonly StockMoveLineEntry[];
  readonly total: number;
  readonly limit: number;
}

export interface StockArticleOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitCode: string;
}

/** STK-009 — seuls les produits actifs génèrent un mouvement : le sélecteur ne montre qu'eux. */
export async function listProductOptions(
  db: Database,
  tenantId: string,
): Promise<readonly StockArticleOption[]> {
  return db
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      unitCode: articles.unitCode,
    })
    .from(articles)
    .where(
      and(eq(articles.tenantId, tenantId), eq(articles.type, "product"), eq(articles.active, true)),
    )
    .orderBy(asc(articles.name), asc(articles.code));
}

function moveConditions(filters: StockFilters): readonly (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  if (filters.search !== "") {
    const like = `%${filters.search.replace(/[%_]/g, "")}%`;
    conditions.push(
      or(ilike(stockMoves.number, like), ilike(articles.code, like), ilike(articles.name, like)),
    );
  }
  if (filters.locationId) {
    conditions.push(
      or(
        eq(stockMoves.fromLocationId, filters.locationId),
        eq(stockMoves.toLocationId, filters.locationId),
      ),
    );
  }
  if (filters.type) {
    conditions.push(eq(stockMoves.type, filters.type));
  }
  if (filters.from) {
    conditions.push(gte(stockMoves.realDate, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(stockMoves.realDate, filters.to));
  }

  return conditions;
}

/** STK-009 — le registre lit les lignes de mouvement, filtrées par texte, magasin, type et période. */
export async function listStockMoves(
  db: Database,
  tenantId: string,
  filters: StockFilters,
): Promise<StockMovePage> {
  const fromLocation = alias(stockLocations, "from_location");
  const toLocation = alias(stockLocations, "to_location");
  const conditions = and(eq(stockMoveLines.tenantId, tenantId), ...moveConditions(filters));

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        moveId: stockMoves.id,
        lineNumber: stockMoveLines.lineNumber,
        number: stockMoves.number,
        type: stockMoves.type,
        realDate: stockMoves.realDate,
        fromCode: fromLocation.code,
        toCode: toLocation.code,
        articleId: articles.id,
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        qty: stockMoveLines.qty,
        notes: stockMoves.notes,
        cancelsMoveId: stockMoves.cancelsMoveId,
        receptionId: stockMoves.receptionId,
        deliveryId: stockMoves.deliveryId,
        purchaseOrderId: stockMoves.purchaseOrderId,
        salesOrderId: stockMoves.salesOrderId,
        createdAt: stockMoves.createdAt,
      })
      .from(stockMoveLines)
      .innerJoin(
        stockMoves,
        and(
          eq(stockMoves.tenantId, stockMoveLines.tenantId),
          eq(stockMoves.id, stockMoveLines.moveId),
        ),
      )
      .innerJoin(
        articles,
        and(
          eq(articles.tenantId, stockMoveLines.tenantId),
          eq(articles.id, stockMoveLines.articleId),
        ),
      )
      .innerJoin(
        fromLocation,
        and(
          eq(fromLocation.tenantId, stockMoves.tenantId),
          eq(fromLocation.id, stockMoves.fromLocationId),
        ),
      )
      .innerJoin(
        toLocation,
        and(
          eq(toLocation.tenantId, stockMoves.tenantId),
          eq(toLocation.id, stockMoves.toLocationId),
        ),
      )
      .where(conditions)
      .orderBy(desc(stockMoves.createdAt), asc(stockMoveLines.lineNumber))
      .limit(STOCK_MOVE_LIMIT),
    db
      .select({ value: count() })
      .from(stockMoveLines)
      .innerJoin(
        stockMoves,
        and(
          eq(stockMoves.tenantId, stockMoveLines.tenantId),
          eq(stockMoves.id, stockMoveLines.moveId),
        ),
      )
      .innerJoin(
        articles,
        and(
          eq(articles.tenantId, stockMoveLines.tenantId),
          eq(articles.id, stockMoveLines.articleId),
        ),
      )
      .innerJoin(
        fromLocation,
        and(
          eq(fromLocation.tenantId, stockMoves.tenantId),
          eq(fromLocation.id, stockMoves.fromLocationId),
        ),
      )
      .innerJoin(
        toLocation,
        and(
          eq(toLocation.tenantId, stockMoves.tenantId),
          eq(toLocation.id, stockMoves.toLocationId),
        ),
      )
      .where(conditions),
  ]);

  return {
    rows: rows.map((row) => ({
      moveId: row.moveId,
      lineNumber: row.lineNumber,
      number: row.number,
      type: row.type,
      realDate: row.realDate,
      fromCode: row.fromCode,
      toCode: row.toCode,
      articleId: row.articleId,
      articleCode: row.articleCode,
      articleName: row.articleName,
      unitCode: row.unitCode,
      qty: normalizeQuantity(row.qty),
      notes: row.notes,
      cancelsMoveId: row.cancelsMoveId,
      cancellable:
        row.cancelsMoveId === null &&
        row.receptionId === null &&
        row.deliveryId === null &&
        row.purchaseOrderId === null &&
        row.salesOrderId === null,
      createdAt: row.createdAt,
    })),
    total: totalRow?.value ?? 0,
    limit: STOCK_MOVE_LIMIT,
  };
}

/* --------------------------------------------------------------- valorisation (STK-010) */

export interface StockValuationLine {
  readonly locationCode: string;
  readonly locationName: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly quantity: string;
  readonly unitPriceXof: number;
  readonly valueXof: number;
}

export interface StockValuation {
  readonly lines: readonly StockValuationLine[];
  readonly totalXof: number;
}

/**
 * STK-010 — l'état valorisé compte le stock détenu au prix d'achat de la fiche article, magasin
 * interne par magasin interne. Aucun coût moyen pondéré : la valeur suit le prix de référence.
 */
export async function getStockValuation(db: Database, tenantId: string): Promise<StockValuation> {
  const rows = await db
    .select({
      locationCode: stockLocations.code,
      locationName: stockLocations.name,
      articleCode: articles.code,
      articleName: articles.name,
      unitCode: articles.unitCode,
      quantity: stockLevels.quantity,
      unitPriceXof: articles.purchasePriceXof,
    })
    .from(stockLevels)
    .innerJoin(
      stockLocations,
      and(
        eq(stockLocations.tenantId, stockLevels.tenantId),
        eq(stockLocations.id, stockLevels.locationId),
      ),
    )
    .innerJoin(
      articles,
      and(eq(articles.tenantId, stockLevels.tenantId), eq(articles.id, stockLevels.articleId)),
    )
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLocations.type, "internal"),
        sql`${stockLevels.quantity} > 0`,
      ),
    )
    .orderBy(asc(stockLocations.code), asc(articles.name));

  let totalXof = 0;
  const lines = rows.map((row) => {
    const quantity = normalizeQuantity(row.quantity);
    const valueXof = computeLineTotal(quantity, row.unitPriceXof);
    totalXof += valueXof;
    return { ...row, quantity, valueXof };
  });

  return { lines, totalXof };
}
