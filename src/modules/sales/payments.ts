import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, invoicePayments, invoices } from "@/db/schema";
import { formatXof } from "@/lib/money";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import { SalesError } from "./errors";
import { isPaymentMethod } from "./payment-methods";

export { isPaymentMethod, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "./payment-methods";

export interface CreatePaymentInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly invoiceId: string;
  readonly amountXof: unknown;
  readonly paidDate: unknown;
  readonly method: unknown;
  readonly reference: unknown;
}

export interface CreatePaymentResult {
  readonly id: string;
  readonly balanceXof: number;
}

export async function createInvoicePayment(
  db: Database,
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  return db.transaction(async (tx) => {
    const amount = parseXofPrice(input.amountXof, "Montant");
    if (amount.errors.length > 0) {
      throw new SalesError(amount.errors.join("\n"));
    }
    if (amount.value <= 0) {
      throw new SalesError("Le montant du règlement doit être strictement positif.");
    }

    const date = parseIsoDate(input.paidDate, "Date de règlement", true);
    if (!date.value) {
      throw new SalesError(date.errors.join("\n"));
    }
    if (date.value > todayIsoDate()) {
      throw new SalesError("La date de règlement ne peut pas être dans le futur.");
    }

    const methodText =
      input.method === null || input.method === undefined ? "" : String(input.method).trim();
    if (!isPaymentMethod(methodText)) {
      throw new SalesError(
        "Moyen de paiement inconnu : virement, espèces, chèque ou mobile money.",
      );
    }

    const referenceText =
      input.reference === null || input.reference === undefined
        ? ""
        : String(input.reference).trim();
    if (referenceText.length > 60) {
      throw new SalesError("Référence du règlement : 60 caractères maximum.");
    }

    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)))
      .limit(1)
      .for("update");

    if (!invoice) {
      throw new SalesError("Facture introuvable dans cet espace de travail.");
    }
    if (invoice.status !== "validated") {
      throw new SalesError("Un règlement exige une facture validée.");
    }

    const [totals] = await tx
      .select({ paid: sql<string>`coalesce(sum(${invoicePayments.amountXof}), 0)` })
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.tenantId, input.tenantId),
          eq(invoicePayments.invoiceId, invoice.id),
        ),
      );

    const paid = Number(totals?.paid ?? 0);
    const balance = invoice.exTaxTotal - paid;
    if (amount.value > balance) {
      throw new SalesError(`Montant supérieur au solde restant de ${formatXof(balance)}.`);
    }

    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        tenantId: input.tenantId,
        invoiceId: invoice.id,
        amountXof: amount.value,
        paidDate: date.value,
        method: methodText,
        reference: referenceText || null,
        createdBy: input.actorUserId,
      })
      .returning({ id: invoicePayments.id });

    if (!payment) {
      throw new SalesError("Le règlement n'a pas pu être écrit.");
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.invoice.payment",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        number: invoice.number,
        amountXof: amount.value,
        method: methodText,
        balanceXof: balance - amount.value,
      },
    });

    return { id: payment.id, balanceXof: balance - amount.value };
  });
}
