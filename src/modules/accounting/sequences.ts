import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { journalEntrySequences } from "@/db/schema";
import { isoDateYear } from "@/lib/dates";
import { MAX_JOURNAL_ENTRY_SEQUENCE } from "./constants";
import { AccountingError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function formatEntryNumber(journalCode: string, period: number, value: number): string {
  return `${journalCode}-${period}-${String(value).padStart(4, "0")}`;
}

export async function nextJournalEntryNumber(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly journalId: string;
    readonly journalCode: string;
    readonly entryDate: string;
  },
): Promise<string> {
  const period = isoDateYear(input.entryDate);

  const [row] = await tx
    .insert(journalEntrySequences)
    .values({
      tenantId: input.tenantId,
      journalId: input.journalId,
      period,
      lastValue: 1,
    })
    .onConflictDoUpdate({
      target: [
        journalEntrySequences.tenantId,
        journalEntrySequences.journalId,
        journalEntrySequences.period,
      ],
      set: {
        lastValue: sql`${journalEntrySequences.lastValue} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ lastValue: journalEntrySequences.lastValue });

  if (!row) {
    throw new AccountingError("La numérotation de l'écriture n'a pas pu être attribuée.");
  }
  if (row.lastValue > MAX_JOURNAL_ENTRY_SEQUENCE) {
    throw new AccountingError(
      `Séquence ${input.journalCode}-${period} épuisée : ${MAX_JOURNAL_ENTRY_SEQUENCE} écritures par journal et par année maximum.`,
    );
  }

  return formatEntryNumber(input.journalCode, period, row.lastValue);
}
