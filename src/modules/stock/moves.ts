import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { articles, stockLevels, stockLocations, stockMoveLines, stockMoves } from "@/db/schema";
import type { StockMoveType } from "@/db/schema";
import { parseQuantity, microsToQuantity } from "./quantities";
import { nextDocumentNumber } from "./sequences";
import { StockError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StockMoveLineInput {
  readonly articleId: string;
  readonly purchaseOrderLineId?: string | null;
  readonly qty: string;
  readonly unitPriceXof?: number | null;
}

export interface InsertStockMoveInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly type: StockMoveType;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly partnerId?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly receptionId?: string | null;
  readonly cancelsMoveId?: string | null;
  readonly realDate: string;
  readonly notes?: string | null;
  readonly lines: readonly StockMoveLineInput[];
}

export interface InsertedStockMove {
  readonly id: string;
  readonly number: string;
}

async function increaseLevel(
  tx: Transaction,
  input: { tenantId: string; locationId: string; articleId: string; quantity: string },
): Promise<void> {
  await tx
    .insert(stockLevels)
    .values({
      tenantId: input.tenantId,
      locationId: input.locationId,
      articleId: input.articleId,
      quantity: input.quantity,
    })
    .onConflictDoUpdate({
      target: [stockLevels.tenantId, stockLevels.locationId, stockLevels.articleId],
      set: {
        quantity: sql`${stockLevels.quantity} + excluded.quantity`,
        updatedAt: sql`now()`,
      },
    });
}

async function decreaseLevel(
  tx: Transaction,
  input: {
    tenantId: string;
    locationId: string;
    articleId: string;
    quantity: string;
    articleCode: string;
    locationCode: string;
  },
): Promise<void> {
  const [updated] = await tx
    .update(stockLevels)
    .set({
      quantity: sql`${stockLevels.quantity} - ${input.quantity}::numeric`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(stockLevels.tenantId, input.tenantId),
        eq(stockLevels.locationId, input.locationId),
        eq(stockLevels.articleId, input.articleId),
        sql`${stockLevels.quantity} >= ${input.quantity}::numeric`,
      ),
    )
    .returning({ id: stockLevels.id });

  if (!updated) {
    throw new StockError(
      `Stock insuffisant pour ${input.articleCode} dans l'emplacement ${input.locationCode} : l'opération est refusée.`,
    );
  }
}

export async function insertStockMove(
  tx: Transaction,
  input: InsertStockMoveInput,
): Promise<InsertedStockMove> {
  if (input.lines.length === 0) {
    throw new StockError("Un mouvement de stock exige au moins une ligne.");
  }
  if (input.fromLocationId === input.toLocationId) {
    throw new StockError("L'emplacement d'origine et de destination doivent différer.");
  }
  if (input.notes && input.notes.length > 1000) {
    throw new StockError("Notes du mouvement : 1000 caractères maximum.");
  }

  const articleIds = [...new Set(input.lines.map((line) => line.articleId))];
  const articleRows = await tx
    .select({ id: articles.id, code: articles.code, type: articles.type })
    .from(articles)
    .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.id, articleIds)));
  const articlesById = new Map(articleRows.map((row) => [row.id, row]));
  if (articlesById.size !== articleIds.length) {
    throw new StockError("Un article du mouvement est introuvable dans cet espace.");
  }
  for (const article of articleRows) {
    if (article.type !== "product") {
      throw new StockError(
        `L'article ${article.code} est un service : seuls les produits génèrent un mouvement de stock.`,
      );
    }
  }

  const locationIds = [...new Set([input.fromLocationId, input.toLocationId])];
  const locationRows = await tx
    .select({ id: stockLocations.id, code: stockLocations.code, type: stockLocations.type })
    .from(stockLocations)
    .where(
      and(eq(stockLocations.tenantId, input.tenantId), inArray(stockLocations.id, locationIds)),
    );
  const locationsById = new Map(locationRows.map((row) => [row.id, row]));
  if (locationsById.size !== locationIds.length) {
    throw new StockError("Un emplacement du mouvement est introuvable dans cet espace.");
  }

  const quantityByArticle = new Map<string, bigint>();
  const lines = input.lines.map((line, index) => {
    const parsed = parseQuantity(line.qty, `Ligne ${index + 1} · quantité`);
    if (!parsed.value || !parsed.micros) {
      throw new StockError(parsed.errors.join(" "));
    }
    quantityByArticle.set(
      line.articleId,
      (quantityByArticle.get(line.articleId) ?? 0n) + parsed.micros,
    );
    return { ...line, qty: parsed.value };
  });

  const number = await nextDocumentNumber(tx, {
    tenantId: input.tenantId,
    scope: "stock_move",
    date: input.realDate,
  });

  const [move] = await tx
    .insert(stockMoves)
    .values({
      tenantId: input.tenantId,
      number,
      type: input.type,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      partnerId: input.partnerId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      receptionId: input.receptionId ?? null,
      cancelsMoveId: input.cancelsMoveId ?? null,
      realDate: input.realDate,
      notes: input.notes ?? null,
      createdBy: input.actorUserId,
    })
    .returning({ id: stockMoves.id });

  if (!move) {
    throw new StockError("Le mouvement de stock n'a pas pu être écrit.");
  }

  await tx.insert(stockMoveLines).values(
    lines.map((line, index) => ({
      tenantId: input.tenantId,
      moveId: move.id,
      lineNumber: index + 1,
      articleId: line.articleId,
      purchaseOrderLineId: line.purchaseOrderLineId ?? null,
      qty: line.qty,
      unitPriceXof: line.unitPriceXof ?? null,
    })),
  );

  const affectedLocation =
    input.type === "incoming"
      ? locationsById.get(input.toLocationId)
      : locationsById.get(input.fromLocationId);

  if (affectedLocation?.type === "internal") {
    for (const [articleId, micros] of quantityByArticle) {
      const article = articlesById.get(articleId);
      if (!article) {
        continue;
      }
      const quantity = microsToQuantity(micros);
      if (input.type === "incoming") {
        await increaseLevel(tx, {
          tenantId: input.tenantId,
          locationId: affectedLocation.id,
          articleId,
          quantity,
        });
      } else {
        await decreaseLevel(tx, {
          tenantId: input.tenantId,
          locationId: affectedLocation.id,
          articleId,
          quantity,
          articleCode: article.code,
          locationCode: affectedLocation.code,
        });
      }
    }
  }

  return { id: move.id, number };
}
