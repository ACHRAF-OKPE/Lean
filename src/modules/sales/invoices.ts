import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  invoiceLines,
  invoices,
  salesOrderLines,
  salesOrders,
} from "@/db/schema";
import type { InvoicingState } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  addQuantity,
  compareQuantity,
  computeLineTotal,
  formatQuantity,
  parseQuantity,
  subtractQuantity,
} from "@/modules/stock/quantities";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { SalesError } from "./errors";
import { computeLineInvoicingState, computeOrderInvoicingState } from "./lifecycle";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface InvoiceLineInput {
  readonly orderLineId: string;
  readonly qty: unknown;
}

export interface CreateInvoiceInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly orderId: string;
  readonly invoiceDate: unknown;
  readonly dueDate: unknown;
  readonly notes: unknown;
  readonly lines: readonly InvoiceLineInput[];
}

export interface CreateInvoiceResult {
  readonly invoiceId: string;
  readonly exTaxTotal: number;
}

export interface ValidateInvoiceInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly invoiceId: string;
}

export interface ValidateInvoiceResult {
  readonly number: string;
}

function parseNotes(raw: unknown): string | null {
  const notes = raw === null || raw === undefined ? "" : String(raw).trim();
  if (notes.length > 1000) {
    throw new SalesError("Notes : 1000 caractères maximum.");
  }
  return notes || null;
}

async function articleTypes(
  tx: Transaction,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, "product" | "service">> {
  if (articleIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ id: articles.id, type: articles.type })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, [...articleIds])));
  return new Map(rows.map((row) => [row.id, row.type]));
}

function billableQuantity(
  line: { readonly qty: string; readonly deliveredQty: string; readonly invoicedQty: string },
  articleType: "product" | "service",
): string {
  const base = articleType === "product" ? line.deliveredQty : line.qty;
  const remaining = subtractQuantity(base, line.invoicedQty);
  return compareQuantity(remaining, "0") < 0 ? "0" : remaining;
}

export async function createInvoice(
  db: Database,
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  return db.transaction(async (tx) => {
    const invoiceDate = parseIsoDate(input.invoiceDate, "Date de facture", true);
    if (!invoiceDate.value) {
      throw new SalesError(invoiceDate.errors.join("\n"));
    }
    if (invoiceDate.value > todayIsoDate()) {
      throw new SalesError("La date de facture ne peut pas être dans le futur.");
    }

    const dueDate = parseIsoDate(input.dueDate, "Échéance", true);
    if (!dueDate.value) {
      throw new SalesError(dueDate.errors.join("\n"));
    }
    if (dueDate.value < invoiceDate.value) {
      throw new SalesError("L'échéance doit être postérieure ou égale à la date de facture.");
    }
    const notes = parseNotes(input.notes);

    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, input.orderId)))
      .limit(1)
      .for("update");

    if (!order) {
      throw new SalesError("Commande client introuvable dans cet espace de travail.");
    }
    if (order.status !== "confirmed") {
      throw new SalesError(
        "Une facture se génère depuis une commande confirmée. Confirmez la commande au préalable.",
      );
    }

    const orderLineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(
        and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.orderId, order.id)),
      )
      .orderBy(salesOrderLines.lineNumber)
      .for("update");
    const orderLinesById = new Map(orderLineRows.map((line) => [line.id, line]));
    const types = await articleTypes(
      tx,
      input.tenantId,
      orderLineRows.map((line) => line.articleId),
    );

    const requested = input.lines.filter((line) => {
      const raw = line.qty;
      return raw !== null && raw !== undefined && String(raw).trim() !== "";
    });
    if (requested.length === 0) {
      throw new SalesError("Facture : au moins une quantité positive est obligatoire.");
    }

    interface InvoiceStep {
      readonly line: (typeof orderLineRows)[number];
      readonly qty: string;
      readonly lineTotalXof: number;
    }

    const steps: InvoiceStep[] = [];
    const seen = new Set<string>();

    for (const item of requested) {
      if (seen.has(item.orderLineId)) {
        throw new SalesError("Une même ligne de commande apparaît deux fois dans la facture.");
      }
      seen.add(item.orderLineId);

      const line = orderLinesById.get(item.orderLineId);
      if (!line) {
        throw new SalesError("Une ligne de facture n'appartient pas à cette commande.");
      }

      const billable = billableQuantity(line, types.get(line.articleId) ?? "service");
      if (compareQuantity(billable, "0") === 0) {
        throw new SalesError(`Ligne ${line.lineNumber} : aucune quantité facturable restante.`);
      }

      const parsed = parseQuantity(item.qty, `Ligne ${line.lineNumber} · quantité`);
      if (!parsed.value) {
        throw new SalesError(parsed.errors.join("\n"));
      }
      if (compareQuantity(parsed.value, billable) > 0) {
        throw new SalesError(
          `Ligne ${line.lineNumber} : quantité supérieure à la quantité facturable restante de ${formatQuantity(billable)}.`,
        );
      }

      steps.push({
        line,
        qty: parsed.value,
        lineTotalXof: computeLineTotal(parsed.value, line.unitPriceXof),
      });
    }

    const exTaxTotal = steps.reduce((sum, step) => sum + step.lineTotalXof, 0);
    if (exTaxTotal > MAX_XOF_AMOUNT) {
      throw new SalesError(`Facture : total supérieur à ${MAX_XOF_AMOUNT} XOF.`);
    }

    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId: input.tenantId,
        orderId: order.id,
        customerId: order.customerId,
        status: "draft",
        invoiceDate: invoiceDate.value,
        dueDate: dueDate.value,
        notes,
        exTaxTotal,
        createdBy: input.actorUserId,
      })
      .returning({ id: invoices.id });

    if (!invoice) {
      throw new SalesError("La facture n'a pas pu être écrite.");
    }

    await tx.insert(invoiceLines).values(
      steps.map((step, index) => ({
        tenantId: input.tenantId,
        invoiceId: invoice.id,
        lineNumber: index + 1,
        orderLineId: step.line.id,
        articleId: step.line.articleId,
        name: step.line.name,
        unitCode: step.line.unitCode,
        qty: step.qty,
        unitPriceXof: step.line.unitPriceXof,
        lineTotalXof: step.lineTotalXof,
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.invoice.create",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        orderNumber: order.number,
        lineCount: steps.length,
        exTaxTotal,
      },
    });

    return { invoiceId: invoice.id, exTaxTotal };
  });
}

export async function validateInvoice(
  db: Database,
  input: ValidateInvoiceInput,
): Promise<ValidateInvoiceResult> {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)))
      .limit(1)
      .for("update");

    if (!invoice) {
      throw new SalesError("Facture introuvable dans cet espace de travail.");
    }
    if (invoice.status !== "draft") {
      throw new SalesError("Seule une facture brouillon peut être validée.");
    }

    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, invoice.orderId)))
      .limit(1)
      .for("update");
    if (!order) {
      throw new SalesError("La commande de cette facture est introuvable.");
    }
    if (order.status !== "confirmed") {
      throw new SalesError(
        "La commande n'est plus confirmée : la facture ne peut pas être validée.",
      );
    }

    const orderLineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(
        and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.orderId, order.id)),
      )
      .orderBy(salesOrderLines.lineNumber)
      .for("update");
    const orderLinesById = new Map(orderLineRows.map((line) => [line.id, line]));
    const types = await articleTypes(
      tx,
      input.tenantId,
      orderLineRows.map((line) => line.articleId),
    );

    const invoiceLineRows = await tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, input.tenantId), eq(invoiceLines.invoiceId, invoice.id)))
      .orderBy(invoiceLines.lineNumber)
      .for("update");

    if (invoiceLineRows.length === 0) {
      throw new SalesError("La facture ne contient aucune ligne.");
    }

    const stateByLine = new Map<string, InvoicingState>();
    const nextInvoicedByLine = new Map<string, string>();

    for (const invoiceLine of invoiceLineRows) {
      const line = orderLinesById.get(invoiceLine.orderLineId);
      if (!line) {
        throw new SalesError(
          `Ligne ${invoiceLine.lineNumber} : la ligne de commande est introuvable.`,
        );
      }
      const billable = billableQuantity(line, types.get(line.articleId) ?? "service");
      if (compareQuantity(invoiceLine.qty, billable) > 0) {
        throw new SalesError(
          `Ligne ${invoiceLine.lineNumber} : quantité supérieure à la quantité facturable restante de ${formatQuantity(billable)}.`,
        );
      }
      const nextInvoiced = addQuantity(line.invoicedQty, invoiceLine.qty);
      nextInvoicedByLine.set(line.id, nextInvoiced);
      stateByLine.set(line.id, computeLineInvoicingState(line.qty, nextInvoiced));
    }

    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "invoice",
      date: invoice.invoiceDate,
    });

    await tx
      .update(invoices)
      .set({
        number,
        status: "validated",
        validatedBy: input.actorUserId,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, invoice.id)));

    for (const [lineId, nextInvoiced] of nextInvoicedByLine) {
      await tx
        .update(salesOrderLines)
        .set({ invoicedQty: nextInvoiced, invoicingState: stateByLine.get(lineId) })
        .where(and(eq(salesOrderLines.tenantId, input.tenantId), eq(salesOrderLines.id, lineId)));
    }

    const orderInvoicingState = computeOrderInvoicingState(
      orderLineRows.map((line) => ({
        invoicingState: stateByLine.get(line.id) ?? line.invoicingState,
      })),
    );
    await tx
      .update(salesOrders)
      .set({ invoicingState: orderInvoicingState, updatedAt: new Date() })
      .where(and(eq(salesOrders.tenantId, input.tenantId), eq(salesOrders.id, order.id)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.invoice.validate",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        number,
        orderNumber: order.number,
        exTaxTotal: invoice.exTaxTotal,
      },
    });

    return { number };
  });
}
