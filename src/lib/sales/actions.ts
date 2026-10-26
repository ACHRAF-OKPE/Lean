"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { cancelDelivery, createDelivery } from "@/modules/sales/deliveries";
import { SalesError } from "@/modules/sales/errors";
import { createInvoice, validateInvoice } from "@/modules/sales/invoices";
import type { SalesAction } from "@/modules/sales/lifecycle";
import { createInvoicePayment } from "@/modules/sales/payments";
import { createSalesOrder, transitionSalesOrder } from "@/modules/sales/queries";
import { StockError } from "@/modules/stock/errors";
import type { SalesFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALES_ACTIONS: readonly SalesAction[] = ["confirm", "close", "cancel"];

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): SalesFormState {
  if (error instanceof SalesError || error instanceof StockError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function createSalesOrderAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const articleIds = formData.getAll("articleId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const prices = formData.getAll("prix_unitaire_xof").map(String);
  const rowCount = Math.max(articleIds.length, quantities.length, prices.length);
  const lines = Array.from({ length: rowCount }, (_, index) => ({
    articleId: articleIds[index] ?? "",
    qty: quantities[index] ?? "",
    unitPriceXof: prices[index] ?? "",
  })).filter(
    (line) =>
      line.articleId.trim() !== "" || line.qty.trim() !== "" || line.unitPriceXof.trim() !== "",
  );

  let createdId: string;
  let warningCount: number;
  try {
    const created = await createSalesOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: {
        customerId: text(formData, "customerId"),
        expectedDeliveryDate: text(formData, "expectedDeliveryDate"),
        externalReference: text(formData, "externalReference"),
        incoterm: text(formData, "incoterm"),
        notes: text(formData, "notes"),
        lines,
      },
    });
    createdId = created.id;
    warningCount = created.warnings.length;
  } catch (error) {
    return failure(error);
  }

  const warningParam = warningCount > 0 ? `&avertissements=${warningCount}` : "";
  redirect(`/ventes/${createdId}?cree=1${warningParam}`);
}

export async function transitionSalesOrderAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const orderId = text(formData, "orderId");
  const requested = text(formData, "action") as SalesAction;

  if (!UUID_PATTERN.test(orderId)) {
    return { errors: ["Commande client invalide."] };
  }
  if (!SALES_ACTIONS.includes(requested)) {
    return { errors: ["Action inconnue."] };
  }

  let status: string;
  try {
    const result = await transitionSalesOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      action: requested,
    });
    status = result.status;
  } catch (error) {
    return failure(error);
  }

  redirect(`/ventes/${orderId}?maj=${status}`);
}

export async function createDeliveryAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const orderId = text(formData, "orderId");
  const locationId = text(formData, "locationId");

  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(locationId)) {
    return { errors: ["Commande ou emplacement invalide."] };
  }

  const orderLineIds = formData.getAll("orderLineId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const lines = orderLineIds.map((orderLineId, index) => ({
    orderLineId,
    qty: quantities[index] ?? "",
  }));

  let number: string;
  try {
    const result = await createDelivery(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      locationId,
      deliveredDate: text(formData, "deliveredDate"),
      notes: text(formData, "notes"),
      lines,
    });
    number = result.number;
  } catch (error) {
    return failure(error);
  }

  redirect(`/ventes/${orderId}?livraison=${encodeURIComponent(number)}`);
}

export async function cancelDeliveryAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const deliveryId = text(formData, "deliveryId");
  const orderId = text(formData, "orderId");

  if (!UUID_PATTERN.test(deliveryId) || !UUID_PATTERN.test(orderId)) {
    return { errors: ["Livraison invalide."] };
  }

  let number: string;
  try {
    const result = await cancelDelivery(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      deliveryId,
    });
    number = result.number;
  } catch (error) {
    return failure(error);
  }

  redirect(`/ventes/${orderId}?livraison_annulee=${encodeURIComponent(number)}`);
}

export async function createInvoiceAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const orderId = text(formData, "orderId");

  if (!UUID_PATTERN.test(orderId)) {
    return { errors: ["Commande client invalide."] };
  }

  const orderLineIds = formData.getAll("orderLineId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const lines = orderLineIds.map((orderLineId, index) => ({
    orderLineId,
    qty: quantities[index] ?? "",
  }));

  let invoiceId: string;
  try {
    const result = await createInvoice(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      invoiceDate: text(formData, "invoiceDate"),
      dueDate: text(formData, "dueDate"),
      notes: text(formData, "notes"),
      lines,
    });
    invoiceId = result.invoiceId;
  } catch (error) {
    return failure(error);
  }

  redirect(`/factures/${invoiceId}?cree=1`);
}

export async function validateInvoiceAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const invoiceId = text(formData, "invoiceId");

  if (!UUID_PATTERN.test(invoiceId)) {
    return { errors: ["Facture invalide."] };
  }

  let number: string;
  try {
    const result = await validateInvoice(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      invoiceId,
    });
    number = result.number;
  } catch (error) {
    return failure(error);
  }

  redirect(`/factures/${invoiceId}?validee=${encodeURIComponent(number)}`);
}

export async function createPaymentAction(
  _state: SalesFormState,
  formData: FormData,
): Promise<SalesFormState> {
  const session = await requirePermission("data.write");
  const invoiceId = text(formData, "invoiceId");

  if (!UUID_PATTERN.test(invoiceId)) {
    return { errors: ["Facture invalide."] };
  }

  try {
    await createInvoicePayment(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      invoiceId,
      amountXof: text(formData, "amountXof"),
      paidDate: text(formData, "paidDate"),
      method: text(formData, "method"),
      reference: text(formData, "reference"),
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/factures/${invoiceId}?regle=1`);
}
