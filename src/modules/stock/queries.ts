import { and, asc, count, countDistinct, desc, eq, sql } from "drizzle-orm";
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
import { normalizeQuantity } from "./quantities";

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
