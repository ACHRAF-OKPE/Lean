import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, stockLocations, stockMoveLines, stockMoves } from "@/db/schema";
import type { StockMoveType } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate } from "@/modules/shared/validation";
import { ensureDefaultLocations } from "./locations";
import { insertStockMove } from "./moves";
import { loadStockSettings } from "./settings";
import { StockError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StockOperationLineInput {
  readonly articleId: unknown;
  readonly qty: unknown;
}

interface NormalizedLine {
  readonly articleId: string;
  readonly qty: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function parseOperationDate(raw: unknown, label: string): string {
  const parsed = parseIsoDate(raw, label, true);
  if (!parsed.value) {
    throw new StockError(parsed.errors.join(" "));
  }
  if (parsed.value > todayIsoDate()) {
    throw new StockError(`${label} ne peut pas être dans le futur.`);
  }
  return parsed.value;
}

function parseNotes(raw: unknown): string | null {
  const notes = textOf(raw);
  if (notes.length > 1000) {
    throw new StockError("Notes : 1000 caractères maximum.");
  }
  return notes || null;
}

function normalizeLines(lines: readonly StockOperationLineInput[]): readonly NormalizedLine[] {
  const kept = lines.filter((line) => {
    const qty = textOf(line.qty);
    const articleId = textOf(line.articleId);
    return qty !== "" || articleId !== "";
  });
  if (kept.length === 0) {
    throw new StockError("Au moins une ligne d'article est obligatoire.");
  }

  const seen = new Set<string>();
  const normalized: NormalizedLine[] = [];
  for (const line of kept) {
    const articleId = textOf(line.articleId);
    if (!UUID_PATTERN.test(articleId)) {
      throw new StockError("Chaque ligne doit référencer un article valide.");
    }
    if (seen.has(articleId)) {
      throw new StockError("Un même article apparaît deux fois : regroupez les quantités.");
    }
    seen.add(articleId);

    const qty = textOf(line.qty);
    if (qty === "") {
      throw new StockError("Chaque ligne exige une quantité.");
    }
    normalized.push({ articleId, qty });
  }
  return normalized;
}

async function requireInternalActiveLocation(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  label: string,
): Promise<{ id: string; code: string }> {
  if (!UUID_PATTERN.test(locationId)) {
    throw new StockError(`${label} : emplacement invalide.`);
  }
  const [location] = await tx
    .select({ id: stockLocations.id, code: stockLocations.code, active: stockLocations.active })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        eq(stockLocations.id, locationId),
        eq(stockLocations.type, "internal"),
      ),
    )
    .limit(1);
  if (!location) {
    throw new StockError(`${label} : magasin introuvable dans cet espace.`);
  }
  if (!location.active) {
    throw new StockError(`${label} : le magasin ${location.code} est inactif.`);
  }
  return { id: location.id, code: location.code };
}

/* ------------------------------------------------------------------ transferts */

export interface CreateTransferInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly realDate: unknown;
  readonly notes: unknown;
  readonly lines: readonly StockOperationLineInput[];
}

export interface StockOperationResult {
  readonly moveId: string;
  readonly number: string;
}

/** STK-007 — un transfert déplace une quantité d'un magasin actif vers un autre. */
export async function createTransfer(
  db: Database,
  input: CreateTransferInput,
): Promise<StockOperationResult> {
  const realDate = parseOperationDate(input.realDate, "Date du transfert");
  const notes = parseNotes(input.notes);
  const lines = normalizeLines(input.lines);

  return db.transaction(async (tx) => {
    const source = await requireInternalActiveLocation(
      tx,
      input.tenantId,
      input.fromLocationId,
      "Magasin d'origine",
    );
    const target = await requireInternalActiveLocation(
      tx,
      input.tenantId,
      input.toLocationId,
      "Magasin de destination",
    );
    if (source.id === target.id) {
      throw new StockError("Le magasin d'origine et de destination doivent différer.");
    }

    const move = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: "transfer",
      fromLocationId: source.id,
      toLocationId: target.id,
      realDate,
      notes,
      lines: lines.map((line) => ({ articleId: line.articleId, qty: line.qty })),
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.transfer.create",
      entityType: "stock_moves",
      entityId: move.id,
      details: {
        number: move.number,
        fromCode: source.code,
        toCode: target.code,
        lineCount: lines.length,
      },
    });

    return { moveId: move.id, number: move.number };
  });
}

/* ------------------------------------------------------------------ ajustements */

export interface CreateAdjustmentInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly locationId: string;
  readonly direction: "in" | "out";
  readonly reason: unknown;
  readonly realDate: unknown;
  readonly lines: readonly StockOperationLineInput[];
}

/** STK-008 — un ajustement d'inventaire passe par l'emplacement virtuel INVENT, jamais par une écriture directe. */
export async function createAdjustment(
  db: Database,
  input: CreateAdjustmentInput,
): Promise<StockOperationResult> {
  if (input.direction !== "in" && input.direction !== "out") {
    throw new StockError("Sens de l'ajustement inconnu.");
  }
  const realDate = parseOperationDate(input.realDate, "Date de l'ajustement");
  const reason = textOf(input.reason);
  const lines = normalizeLines(input.lines);

  return db.transaction(async (tx) => {
    const settings = await loadStockSettings(tx, input.tenantId);
    const reasonRequired = settings?.adjustmentReasonRequired ?? true;
    if (reasonRequired && reason === "") {
      throw new StockError("Motif de l'ajustement : obligatoire.");
    }
    if (reason.length > 200) {
      throw new StockError("Motif de l'ajustement : 200 caractères maximum.");
    }

    const location = await requireInternalActiveLocation(
      tx,
      input.tenantId,
      input.locationId,
      "Magasin",
    );
    const defaults = await ensureDefaultLocations(tx, input.tenantId);

    const incoming = input.direction === "in";
    const move = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: incoming ? "incoming" : "outgoing",
      fromLocationId: incoming ? defaults.inventoryId : location.id,
      toLocationId: incoming ? location.id : defaults.inventoryId,
      realDate,
      notes: reason ? `Ajustement d'inventaire : ${reason}` : "Ajustement d'inventaire",
      lines: lines.map((line) => ({ articleId: line.articleId, qty: line.qty })),
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.adjustment.create",
      entityType: "stock_moves",
      entityId: move.id,
      details: {
        number: move.number,
        direction: input.direction,
        locationCode: location.code,
        reason,
        lineCount: lines.length,
      },
    });

    return { moveId: move.id, number: move.number };
  });
}

/* ------------------------------------------------------- annulation d'un mouvement */

export interface CancelStockMoveInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly moveId: string;
  readonly notes?: unknown;
}

const REVERSAL_TYPE: Record<StockMoveType, StockMoveType> = {
  incoming: "outgoing",
  outgoing: "incoming",
  transfer: "transfer",
};

/** STK-002 — un mouvement ne se supprime jamais : l'annulation écrit l'inverse et le relie à l'original. */
export async function cancelStockMove(
  db: Database,
  input: CancelStockMoveInput,
): Promise<StockOperationResult> {
  const notes = parseNotes(input.notes ?? null);

  return db.transaction(async (tx) => {
    const [move] = await tx
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, input.tenantId), eq(stockMoves.id, input.moveId)))
      .limit(1)
      .for("update");
    if (!move) {
      throw new StockError("Mouvement introuvable dans cet espace.");
    }
    if (move.cancelsMoveId) {
      throw new StockError(
        "Un mouvement inverse ne s'annule pas : annulez le mouvement d'origine.",
      );
    }
    if (move.receptionId || move.deliveryId || move.purchaseOrderId || move.salesOrderId) {
      throw new StockError(
        "Ce mouvement est rattaché à une réception ou une livraison : annulez le document source.",
      );
    }

    const [already] = await tx
      .select({ id: stockMoves.id, number: stockMoves.number })
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, input.tenantId), eq(stockMoves.cancelsMoveId, move.id)))
      .limit(1);
    if (already) {
      throw new StockError(`Ce mouvement est déjà annulé par ${already.number}.`);
    }

    const originalLines = await tx
      .select({
        articleId: stockMoveLines.articleId,
        qty: stockMoveLines.qty,
        unitPriceXof: stockMoveLines.unitPriceXof,
      })
      .from(stockMoveLines)
      .where(and(eq(stockMoveLines.tenantId, input.tenantId), eq(stockMoveLines.moveId, move.id)))
      .orderBy(stockMoveLines.lineNumber)
      .for("update");
    if (originalLines.length === 0) {
      throw new StockError("Ce mouvement ne porte aucune ligne.");
    }

    const reversal = await insertStockMove(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      type: REVERSAL_TYPE[move.type],
      fromLocationId: move.toLocationId,
      toLocationId: move.fromLocationId,
      cancelsMoveId: move.id,
      realDate: todayIsoDate(),
      notes: notes ? `Annulation ${move.number} · ${notes}` : `Annulation ${move.number}`,
      lines: originalLines.map((line) => ({
        articleId: line.articleId,
        qty: line.qty,
        unitPriceXof: line.unitPriceXof,
      })),
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.move.cancel",
      entityType: "stock_moves",
      entityId: move.id,
      details: {
        originalNumber: move.number,
        reversalNumber: reversal.number,
        lineCount: originalLines.length,
      },
    });

    return { moveId: reversal.id, number: reversal.number };
  });
}
