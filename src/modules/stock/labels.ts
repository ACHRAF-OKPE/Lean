import type { StockMoveType } from "@/db/schema";

/** STK-009 — libellés français des types de mouvement, partagés par les vues du registre. */
export const STOCK_MOVE_TYPE_LABELS: Record<StockMoveType, string> = {
  incoming: "Entrée",
  outgoing: "Sortie",
  transfer: "Transfert",
};

export const STOCK_MOVE_TYPE_OPTIONS: readonly StockMoveType[] = [
  "incoming",
  "outgoing",
  "transfer",
];
