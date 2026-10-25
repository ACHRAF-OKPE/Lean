import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { documentSequences, type DocumentScope } from "@/db/schema";
import { isoDateYear, todayIsoDate } from "@/lib/dates";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const PREFIXES: Record<DocumentScope, string> = {
  purchase_order: "CMD",
  reception: "REC",
  stock_move: "MVT",
};

const MAX_SEQUENCE_VALUE = 9999;

export class SequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SequenceError";
  }
}

export function formatDocumentNumber(scope: DocumentScope, period: number, value: number): string {
  return `${PREFIXES[scope]}-${period}-${String(value).padStart(4, "0")}`;
}

export function sequencePeriod(dateOrIso: string | Date = new Date()): number {
  return typeof dateOrIso === "string"
    ? isoDateYear(dateOrIso)
    : isoDateYear(todayIsoDate(dateOrIso));
}

export async function nextDocumentNumber(
  tx: Transaction,
  input: { tenantId: string; scope: DocumentScope; date?: string | Date },
): Promise<string> {
  const period = sequencePeriod(input.date ?? new Date());

  const [row] = await tx
    .insert(documentSequences)
    .values({ tenantId: input.tenantId, scope: input.scope, period, lastValue: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.tenantId, documentSequences.scope, documentSequences.period],
      set: {
        lastValue: sql`${documentSequences.lastValue} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ lastValue: documentSequences.lastValue });

  if (!row) {
    throw new SequenceError("La numérotation n'a pas pu être attribuée.");
  }
  if (row.lastValue > MAX_SEQUENCE_VALUE) {
    throw new SequenceError(
      `Séquence ${PREFIXES[input.scope]}-${period} épuisée : ${MAX_SEQUENCE_VALUE} documents par an maximum.`,
    );
  }

  return formatDocumentNumber(input.scope, period, row.lastValue);
}
