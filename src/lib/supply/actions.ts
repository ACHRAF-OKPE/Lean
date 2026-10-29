"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { SupplyError } from "@/modules/supply/errors";
import { parseSupplyGrouping } from "@/modules/supply/proposals";
import {
  dismissSupplyLine,
  generateSupplyPurchaseOrders,
  generateSupplyTender,
  runSupplyCalculation,
  saveSupplyPolicy,
} from "@/modules/supply/queries";
import { SequenceError } from "@/modules/stock/sequences";
import type { SupplyFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): SupplyFormState {
  if (error instanceof SupplyError || error instanceof SequenceError) {
    return { errors: error.message.split("\n") };
  }
  throw error;
}

export async function savePolicyAction(
  _state: SupplyFormState,
  formData: FormData,
): Promise<SupplyFormState> {
  const session = await requirePermission("data.write");
  const articleId = text(formData, "articleId");
  if (!UUID_PATTERN.test(articleId)) {
    return { errors: ["Article invalide."] };
  }
  try {
    await saveSupplyPolicy(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      articleId,
      active: formData.get("active") !== null,
      data: {
        supplierId: text(formData, "supplierId"),
        leadTimeDays: text(formData, "leadTimeDays"),
        safetyDelayDays: text(formData, "safetyDelayDays"),
        minStockQty: text(formData, "minStockQty"),
        reorderQty: text(formData, "reorderQty"),
        orderMultipleQty: text(formData, "orderMultipleQty"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/achats/approvisionnement?maj=1");
}

export async function runCalculationAction(
  _state: SupplyFormState,
  formData: FormData,
): Promise<SupplyFormState> {
  const session = await requirePermission("data.write");
  let created: { id: string; number: string };
  try {
    created = await runSupplyCalculation(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      horizonDays: text(formData, "horizonDays"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/besoins/${created.id}?calcule=${encodeURIComponent(created.number)}`);
}

export async function generateOrdersAction(
  _state: SupplyFormState,
  formData: FormData,
): Promise<SupplyFormState> {
  const session = await requirePermission("data.write");
  const runId = text(formData, "runId");
  if (!UUID_PATTERN.test(runId)) {
    return { errors: ["Calcul des besoins invalide."] };
  }
  const grouping = parseSupplyGrouping(text(formData, "grouping"));
  if (!grouping) {
    return { errors: ["Regroupement des commandes invalide."] };
  }
  const lineIds = formData.getAll("lineId").map(String).filter(Boolean);
  let orderCount: number;
  try {
    const result = await generateSupplyPurchaseOrders(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      runId,
      lineIds,
      grouping,
    });
    orderCount = result.orderIds.length;
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/besoins/${runId}?commandes=${orderCount}`);
}

export async function generateTenderAction(
  _state: SupplyFormState,
  formData: FormData,
): Promise<SupplyFormState> {
  const session = await requirePermission("data.write");
  const runId = text(formData, "runId");
  if (!UUID_PATTERN.test(runId)) {
    return { errors: ["Calcul des besoins invalide."] };
  }
  const lineIds = formData.getAll("lineId").map(String).filter(Boolean);
  let tenderId: string;
  try {
    const result = await generateSupplyTender(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      runId,
      lineIds,
      deadline: text(formData, "deadline"),
    });
    tenderId = result.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?cree=1`);
}

export async function dismissLineAction(
  _state: SupplyFormState,
  formData: FormData,
): Promise<SupplyFormState> {
  const session = await requirePermission("data.write");
  const runId = text(formData, "runId");
  const lineId = text(formData, "lineId");
  if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(lineId)) {
    return { errors: ["Proposition invalide."] };
  }
  try {
    await dismissSupplyLine(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      runId,
      lineId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/besoins/${runId}?ecartee=1`);
}
