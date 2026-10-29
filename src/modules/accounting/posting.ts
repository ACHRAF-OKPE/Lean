import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accountingJournals,
  auditEvents,
  fiscalYears,
  invoicePayments,
  invoices,
  journalEntries,
  ledgerAccounts,
  purchaseOrders,
  receptions,
  stockMoveLines,
  stockMoves,
} from "@/db/schema";
import type { JournalEntrySource } from "@/db/schema";
import { computeLineTotal } from "@/modules/stock/quantities";
import { listCutoffDocuments } from "./cutoff";
import { AccountingError } from "./errors";
import { insertJournalEntry } from "./queries";
import { loadAccountingSettings } from "./settings";
import type { EntryLineInput } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PostingResult {
  readonly id: string;
  readonly number: string;
}

interface PostingContext {
  readonly journalId: string;
  readonly journalCode: string;
  readonly fiscalYearId: string;
  readonly fiscalYearLabel: string;
}

async function requireContext(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly entryDate: string;
    readonly journalId: string;
    readonly accountIds: readonly string[];
  },
): Promise<PostingContext> {
  const [year] = await tx
    .select({
      id: fiscalYears.id,
      label: fiscalYears.label,
    })
    .from(fiscalYears)
    .where(
      and(
        eq(fiscalYears.tenantId, input.tenantId),
        eq(fiscalYears.status, "open"),
        lte(fiscalYears.startsOn, input.entryDate),
        gte(fiscalYears.endsOn, input.entryDate),
      ),
    )
    .limit(1);
  if (!year) {
    throw new AccountingError(
      `Aucun exercice ouvert ne couvre le ${input.entryDate} : la comptabilisation est refusée.`,
    );
  }

  const [journal] = await tx
    .select({
      id: accountingJournals.id,
      code: accountingJournals.code,
      active: accountingJournals.active,
    })
    .from(accountingJournals)
    .where(
      and(
        eq(accountingJournals.tenantId, input.tenantId),
        eq(accountingJournals.id, input.journalId),
      ),
    )
    .limit(1);
  if (!journal) {
    throw new AccountingError("Journal comptable introuvable : vérifiez le paramétrage.");
  }
  if (!journal.active) {
    throw new AccountingError(
      `Le journal ${journal.code} est inactif : réactivez-le ou changez le paramétrage.`,
    );
  }

  const accounts = await tx
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      active: ledgerAccounts.active,
    })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.tenantId, input.tenantId),
        inArray(ledgerAccounts.id, input.accountIds as string[]),
      ),
    );
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  for (const accountId of input.accountIds) {
    const account = accountsById.get(accountId);
    if (!account) {
      throw new AccountingError("Compte comptable introuvable : vérifiez le paramétrage.");
    }
    if (!account.active) {
      throw new AccountingError(
        `Le compte ${account.code} est inactif : réactivez-le ou changez le paramétrage.`,
      );
    }
  }

  return {
    journalId: journal.id,
    journalCode: journal.code,
    fiscalYearId: year.id,
    fiscalYearLabel: year.label,
  };
}

interface PostEntryInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly source: Exclude<JournalEntrySource, "manual" | "import">;
  readonly sourceId: string;
  readonly entryDate: string;
  readonly reference: string | null;
  readonly label: string;
  readonly lines: readonly EntryLineInput[];
}

async function postEntry(
  tx: Transaction,
  context: PostingContext,
  input: PostEntryInput,
): Promise<PostingResult> {
  const entry = await insertJournalEntry(tx, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    journalId: context.journalId,
    journalCode: context.journalCode,
    fiscalYearId: context.fiscalYearId,
    fiscalYearLabel: context.fiscalYearLabel,
    entryDate: input.entryDate,
    reference: input.reference,
    label: input.label,
    lines: input.lines,
    source: input.source,
    sourceId: input.sourceId,
    validated: true,
  });
  return { id: entry.id, number: entry.number };
}

export async function hasPostedEntry(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly source: JournalEntrySource;
    readonly sourceId: string;
  },
): Promise<boolean> {
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, input.tenantId),
        eq(journalEntries.source, input.source),
        eq(journalEntries.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface PostSaleInvoiceInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly invoiceId: string;
  readonly number: string;
  readonly invoiceDate: string;
  readonly customerId: string;
  readonly totalXof: number;
}

export async function postSaleInvoice(
  tx: Transaction,
  input: PostSaleInvoiceInput,
): Promise<PostingResult | null> {
  const settings = await loadAccountingSettings(tx, input.tenantId);
  if (!settings || input.totalXof <= 0) {
    return null;
  }
  const context = await requireContext(tx, {
    tenantId: input.tenantId,
    entryDate: input.invoiceDate,
    journalId: settings.salesJournalId,
    accountIds: [settings.customerAccountId, settings.salesAccountId],
  });
  return postEntry(tx, context, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    source: "sale_invoice",
    sourceId: input.invoiceId,
    entryDate: input.invoiceDate,
    reference: input.number,
    label: `Facture ${input.number}`,
    lines: [
      {
        accountId: settings.customerAccountId,
        partnerId: input.customerId,
        label: `Facture ${input.number}`,
        debit: input.totalXof,
        credit: 0,
      },
      {
        accountId: settings.salesAccountId,
        partnerId: null,
        label: `Vente ${input.number}`,
        debit: 0,
        credit: input.totalXof,
      },
    ],
  });
}

export interface PostSalePaymentInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly paymentId: string;
  readonly invoiceNumber: string;
  readonly paidDate: string;
  readonly customerId: string;
  readonly amountXof: number;
  readonly reference: string | null;
}

export async function postSalePayment(
  tx: Transaction,
  input: PostSalePaymentInput,
): Promise<PostingResult | null> {
  const settings = await loadAccountingSettings(tx, input.tenantId);
  if (!settings || input.amountXof <= 0) {
    return null;
  }
  const context = await requireContext(tx, {
    tenantId: input.tenantId,
    entryDate: input.paidDate,
    journalId: settings.bankJournalId,
    accountIds: [settings.bankAccountId, settings.customerAccountId],
  });
  const reference = input.reference ?? input.invoiceNumber;
  return postEntry(tx, context, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    source: "sale_payment",
    sourceId: input.paymentId,
    entryDate: input.paidDate,
    reference,
    label: `Règlement ${input.invoiceNumber}`,
    lines: [
      {
        accountId: settings.bankAccountId,
        partnerId: null,
        label: `Règlement ${input.invoiceNumber}`,
        debit: input.amountXof,
        credit: 0,
      },
      {
        accountId: settings.customerAccountId,
        partnerId: input.customerId,
        label: `Règlement ${input.invoiceNumber}`,
        debit: 0,
        credit: input.amountXof,
      },
    ],
  });
}

export interface ReceptionAccountingLine {
  readonly qty: string;
  readonly unitPriceXof: number;
}

export function receptionValue(lines: readonly ReceptionAccountingLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += computeLineTotal(line.qty, line.unitPriceXof);
  }
  return total;
}

export interface PostPurchaseReceptionInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly receptionId: string;
  readonly number: string;
  readonly receivedDate: string;
  readonly supplierId: string;
  readonly lines: readonly ReceptionAccountingLine[];
}

export async function postPurchaseReception(
  tx: Transaction,
  input: PostPurchaseReceptionInput,
): Promise<PostingResult | null> {
  const settings = await loadAccountingSettings(tx, input.tenantId);
  const total = receptionValue(input.lines);
  if (!settings || total <= 0) {
    return null;
  }
  const context = await requireContext(tx, {
    tenantId: input.tenantId,
    entryDate: input.receivedDate,
    journalId: settings.purchaseJournalId,
    accountIds: [settings.purchaseAccountId, settings.supplierAccountId],
  });
  return postEntry(tx, context, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    source: "purchase_reception",
    sourceId: input.receptionId,
    entryDate: input.receivedDate,
    reference: input.number,
    label: `Réception ${input.number}`,
    lines: [
      {
        accountId: settings.purchaseAccountId,
        partnerId: null,
        label: `Réception ${input.number}`,
        debit: total,
        credit: 0,
      },
      {
        accountId: settings.supplierAccountId,
        partnerId: input.supplierId,
        label: `Réception ${input.number}`,
        debit: 0,
        credit: total,
      },
    ],
  });
}

export interface PostPurchaseReceptionCancelInput extends PostPurchaseReceptionInput {
  readonly cancelDate: string;
}

export async function postPurchaseReceptionCancel(
  tx: Transaction,
  input: PostPurchaseReceptionCancelInput,
): Promise<PostingResult | null> {
  const settings = await loadAccountingSettings(tx, input.tenantId);
  const total = receptionValue(input.lines);
  if (!settings || total <= 0) {
    return null;
  }
  const posted = await hasPostedEntry(tx, {
    tenantId: input.tenantId,
    source: "purchase_reception",
    sourceId: input.receptionId,
  });
  if (!posted) {
    return null;
  }
  const context = await requireContext(tx, {
    tenantId: input.tenantId,
    entryDate: input.cancelDate,
    journalId: settings.purchaseJournalId,
    accountIds: [settings.purchaseAccountId, settings.supplierAccountId],
  });
  return postEntry(tx, context, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    source: "purchase_reception_cancel",
    sourceId: input.receptionId,
    entryDate: input.cancelDate,
    reference: input.number,
    label: `Annulation réception ${input.number}`,
    lines: [
      {
        accountId: settings.supplierAccountId,
        partnerId: input.supplierId,
        label: `Annulation réception ${input.number}`,
        debit: total,
        credit: 0,
      },
      {
        accountId: settings.purchaseAccountId,
        partnerId: null,
        label: `Annulation réception ${input.number}`,
        debit: 0,
        credit: total,
      },
    ],
  });
}

export interface PostCutoffInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly fiscalYearId: string;
}

export interface PostCutoffResult {
  readonly posted: number;
  readonly alreadyPosted: number;
}

export async function postCutoffDocuments(
  db: Database,
  input: PostCutoffInput,
): Promise<PostCutoffResult> {
  return db.transaction(async (tx) => {
    const [year] = await tx
      .select({ id: fiscalYears.id, label: fiscalYears.label, status: fiscalYears.status })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, input.tenantId), eq(fiscalYears.id, input.fiscalYearId)))
      .limit(1)
      .for("update");
    if (!year) {
      throw new AccountingError("Exercice introuvable dans cet espace.");
    }
    if (year.status !== "open") {
      throw new AccountingError(
        `L'exercice ${year.label} est clôturé : aucune comptabilisation n'est possible.`,
      );
    }
    const settings = await loadAccountingSettings(tx, input.tenantId);
    if (!settings) {
      throw new AccountingError("Paramétrez la comptabilité avant de comptabiliser les documents.");
    }

    const { documents } = await listCutoffDocuments(tx, {
      tenantId: input.tenantId,
      fiscalYearId: input.fiscalYearId,
    });

    let posted = 0;
    let alreadyPosted = 0;
    for (const document of documents) {
      if (document.posted) {
        alreadyPosted += 1;
        continue;
      }
      if (document.kind === "sale_invoice") {
        const [invoice] = await tx
          .select({
            number: invoices.number,
            invoiceDate: invoices.invoiceDate,
            customerId: invoices.customerId,
            exTaxTotal: invoices.exTaxTotal,
          })
          .from(invoices)
          .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, document.documentId)))
          .limit(1);
        if (!invoice) {
          continue;
        }
        const result = await postSaleInvoice(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          invoiceId: document.documentId,
          number: invoice.number ?? "",
          invoiceDate: invoice.invoiceDate,
          customerId: invoice.customerId,
          totalXof: invoice.exTaxTotal,
        });
        if (result) {
          posted += 1;
        }
      } else if (document.kind === "sale_payment") {
        const [payment] = await tx
          .select({
            amountXof: invoicePayments.amountXof,
            paidDate: invoicePayments.paidDate,
            reference: invoicePayments.reference,
            invoiceNumber: invoices.number,
            customerId: invoices.customerId,
          })
          .from(invoicePayments)
          .innerJoin(
            invoices,
            and(
              eq(invoices.tenantId, invoicePayments.tenantId),
              eq(invoices.id, invoicePayments.invoiceId),
            ),
          )
          .where(
            and(
              eq(invoicePayments.tenantId, input.tenantId),
              eq(invoicePayments.id, document.documentId),
            ),
          )
          .limit(1);
        if (!payment) {
          continue;
        }
        const result = await postSalePayment(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          paymentId: document.documentId,
          invoiceNumber: payment.invoiceNumber ?? "",
          paidDate: payment.paidDate,
          customerId: payment.customerId,
          amountXof: payment.amountXof,
          reference: payment.reference,
        });
        if (result) {
          posted += 1;
        }
      } else {
        const [reception] = await tx
          .select({
            number: receptions.number,
            receivedDate: receptions.receivedDate,
            supplierId: purchaseOrders.supplierId,
          })
          .from(receptions)
          .innerJoin(
            purchaseOrders,
            and(
              eq(purchaseOrders.tenantId, receptions.tenantId),
              eq(purchaseOrders.id, receptions.orderId),
            ),
          )
          .where(
            and(eq(receptions.tenantId, input.tenantId), eq(receptions.id, document.documentId)),
          )
          .limit(1);
        if (!reception) {
          continue;
        }
        const lines = await tx
          .select({
            qty: stockMoveLines.qty,
            unitPriceXof: stockMoveLines.unitPriceXof,
          })
          .from(stockMoveLines)
          .innerJoin(
            stockMoves,
            and(
              eq(stockMoves.tenantId, stockMoveLines.tenantId),
              eq(stockMoves.id, stockMoveLines.moveId),
            ),
          )
          .where(
            and(
              eq(stockMoves.tenantId, input.tenantId),
              eq(stockMoves.receptionId, document.documentId),
              eq(stockMoves.type, "incoming"),
            ),
          )
          .orderBy(stockMoveLines.lineNumber);
        const result = await postPurchaseReception(tx, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          receptionId: document.documentId,
          number: reception.number,
          receivedDate: reception.receivedDate,
          supplierId: reception.supplierId,
          lines: lines.map((line) => ({
            qty: line.qty,
            unitPriceXof: line.unitPriceXof ?? 0,
          })),
        });
        if (result) {
          posted += 1;
        }
      }
    }

    if (posted > 0) {
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "accounting.cutoff.post",
        entityType: "fiscal_year",
        entityId: year.id,
        details: { fiscalYear: year.label, posted, alreadyPosted },
      });
    }

    return { posted, alreadyPosted };
  });
}
