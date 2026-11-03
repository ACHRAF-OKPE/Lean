"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { StockError } from "@/modules/stock/errors";
import {
  createStockLocation,
  setStockLocationActive,
  updateStockLocation,
} from "@/modules/stock/locations";
import {
  cancelStockMove,
  createAdjustment,
  createTransfer,
  type StockOperationLineInput,
} from "@/modules/stock/operations";
import { saveStockSettings } from "@/modules/stock/settings";
import type { StockFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function values(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function failure(error: unknown): StockFormState {
  if (error instanceof StockError) {
    return { errors: [error.message] };
  }
  throw error;
}

function invalid(label: string): StockFormState {
  return { errors: [`${label} invalide.`] };
}

function operationLines(formData: FormData): readonly StockOperationLineInput[] {
  const articleIds = values(formData, "articleId");
  const quantities = values(formData, "qty");
  return articleIds.map((articleId, index) => ({ articleId, qty: quantities[index] ?? "" }));
}

/* ------------------------------------------------------------------ magasins */

export async function createStockLocationAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "manage");
  let locationId: string;
  try {
    const created = await createStockLocation(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: { code: text(formData, "code"), name: text(formData, "name") },
    });
    locationId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/stock/magasins/${locationId}?cree=1`);
}

export async function updateStockLocationAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "manage");
  const locationId = text(formData, "locationId");
  if (!UUID_PATTERN.test(locationId)) {
    return invalid("Magasin");
  }
  try {
    await updateStockLocation(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      locationId,
      raw: { name: text(formData, "name") },
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/stock/magasins/${locationId}?maj=1`);
}

export async function setStockLocationActiveAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "manage");
  const locationId = text(formData, "locationId");
  if (!UUID_PATTERN.test(locationId)) {
    return invalid("Magasin");
  }
  try {
    await setStockLocationActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      locationId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/stock/magasins?maj=1");
}

/* -------------------------------------------------------- transferts et ajustements */

export async function createTransferAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "write");
  try {
    await createTransfer(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      fromLocationId: text(formData, "fromLocationId"),
      toLocationId: text(formData, "toLocationId"),
      realDate: text(formData, "realDate"),
      notes: text(formData, "notes"),
      lines: operationLines(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/stock/registre?cree=1");
}

export async function createAdjustmentAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "write");
  const direction = text(formData, "direction");
  try {
    await createAdjustment(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      locationId: text(formData, "locationId"),
      direction: direction === "out" ? "out" : "in",
      reason: text(formData, "reason"),
      realDate: text(formData, "realDate"),
      lines: operationLines(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/stock/registre?ajuste=1");
}

export async function cancelStockMoveAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "manage");
  const moveId = text(formData, "moveId");
  if (!UUID_PATTERN.test(moveId)) {
    return invalid("Mouvement");
  }
  try {
    await cancelStockMove(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      moveId,
      notes: text(formData, "notes"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/stock/registre?annule=1");
}

/* ------------------------------------------------------------------ paramétrage */

export async function saveStockSettingsAction(
  _state: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const session = await requireModule("stock", "manage");
  try {
    await saveStockSettings(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        defaultInternalLocationId: text(formData, "defaultInternalLocationId"),
        defaultMinStockQty: text(formData, "defaultMinStockQty"),
        adjustmentReasonRequired: formData.get("adjustmentReasonRequired") !== null,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/stock/parametres?enregistre=1");
}
