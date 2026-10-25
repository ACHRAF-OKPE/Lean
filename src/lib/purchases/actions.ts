"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { PurchaseError } from "@/modules/purchases/errors";
import type { PurchaseAction } from "@/modules/purchases/lifecycle";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { StockError } from "@/modules/stock/errors";
import { cancelReception, createReception } from "@/modules/stock/receptions";
import type { PurchaseFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURCHASE_ACTIONS: readonly PurchaseAction[] = ["request", "confirm", "close", "cancel"];

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): PurchaseFormState {
  if (error instanceof PurchaseError || error instanceof StockError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function createPurchaseOrderAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
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
  try {
    const created = await createPurchaseOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: {
        supplierId: text(formData, "supplierId"),
        expectedReceiptDate: text(formData, "expectedReceiptDate"),
        externalReference: text(formData, "externalReference"),
        notes: text(formData, "notes"),
        lines,
      },
    });
    createdId = created.id;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${createdId}?cree=1`);
}

export async function transitionPurchaseOrderAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requirePermission("data.write");
  const orderId = text(formData, "orderId");
  const requested = text(formData, "action") as PurchaseAction;

  if (!UUID_PATTERN.test(orderId)) {
    return { errors: ["Commande invalide."] };
  }
  if (!PURCHASE_ACTIONS.includes(requested)) {
    return { errors: ["Action inconnue."] };
  }

  let status: string;
  try {
    const result = await transitionPurchaseOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      action: requested,
    });
    status = result.status;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${orderId}?maj=${status}`);
}

export async function createReceptionAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
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
  let warningCount: number;
  try {
    const result = await createReception(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      locationId,
      receivedDate: text(formData, "receivedDate"),
      notes: text(formData, "notes"),
      lines,
    });
    number = result.number;
    warningCount = result.warnings.length;
  } catch (error) {
    return failure(error);
  }

  const warningParam = warningCount > 0 ? `&avertissements=${warningCount}` : "";
  redirect(`/achats/${orderId}?recu=${encodeURIComponent(number)}${warningParam}`);
}

export async function cancelReceptionAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requirePermission("data.write");
  const receptionId = text(formData, "receptionId");
  const orderId = text(formData, "orderId");

  if (!UUID_PATTERN.test(receptionId) || !UUID_PATTERN.test(orderId)) {
    return { errors: ["Réception invalide."] };
  }

  let number: string;
  try {
    const result = await cancelReception(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      receptionId,
    });
    number = result.number;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${orderId}?annulee=${encodeURIComponent(number)}`);
}
