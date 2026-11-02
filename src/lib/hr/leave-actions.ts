"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { isHrLeaveRequestStatus } from "@/modules/hr/constants";
import { HrError } from "@/modules/hr/errors";
import {
  createLeaveRequest,
  createLeaveType,
  deleteLeaveRequest,
  deleteLeaveType,
  setLeaveRequestStatus,
  updateLeaveRequest,
  updateLeaveType,
} from "@/modules/hr/leave-queries";
import type { HrFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): HrFormState {
  if (error instanceof HrError) {
    return { errors: [error.message] };
  }
  throw error;
}

function invalid(label: string): HrFormState {
  return { errors: [`${label} invalide.`] };
}

/* ------------------------------------------------------------- types de congés */

function leaveTypeRaw(formData: FormData) {
  return {
    code: text(formData, "code"),
    name: text(formData, "name"),
    paid: formData.get("paid") !== null,
    halfDayAllowed: formData.get("halfDayAllowed") !== null,
    annualAllowanceDays: text(formData, "annualAllowanceDays"),
    active: formData.get("active") !== null,
  };
}

export async function createLeaveTypeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  let leaveTypeId: string;
  try {
    const created = await createLeaveType(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: leaveTypeRaw(formData),
    });
    leaveTypeId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/conges/types/${leaveTypeId}?cree=1`);
}

export async function updateLeaveTypeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const leaveTypeId = text(formData, "leaveTypeId");
  if (!UUID_PATTERN.test(leaveTypeId)) {
    return invalid("Type de congé");
  }
  try {
    await updateLeaveType(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      leaveTypeId,
      raw: leaveTypeRaw(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/conges/types/${leaveTypeId}?maj=1`);
}

export async function deleteLeaveTypeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const leaveTypeId = text(formData, "leaveTypeId");
  if (!UUID_PATTERN.test(leaveTypeId)) {
    return invalid("Type de congé");
  }
  try {
    await deleteLeaveType(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      leaveTypeId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/conges/types?supprime=1");
}

/* ----------------------------------------------------------- demandes de congé */

function requestRaw(formData: FormData) {
  return {
    employeeId: text(formData, "employeeId"),
    leaveTypeId: text(formData, "leaveTypeId"),
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    startHalfDay: text(formData, "startHalfDay"),
    endHalfDay: text(formData, "endHalfDay"),
    reason: text(formData, "reason"),
  };
}

export async function createLeaveRequestAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const employeeId = text(formData, "employeeId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Salarié");
  }
  let requestId: string;
  try {
    const created = await createLeaveRequest(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: requestRaw(formData),
    });
    requestId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/conges/${requestId}?cree=1`);
}

export async function updateLeaveRequestAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const requestId = text(formData, "requestId");
  if (!UUID_PATTERN.test(requestId)) {
    return invalid("Demande de congé");
  }
  try {
    await updateLeaveRequest(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      requestId,
      raw: requestRaw(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/conges/${requestId}?maj=1`);
}

/** HR-016 — valider, refuser ou annuler relève de la gestion. */
export async function setLeaveRequestStatusAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const requestId = text(formData, "requestId");
  if (!UUID_PATTERN.test(requestId)) {
    return invalid("Demande de congé");
  }
  const status = text(formData, "status");
  if (!isHrLeaveRequestStatus(status) || status === "draft") {
    return invalid("Statut");
  }
  try {
    await setLeaveRequestStatus(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      requestId,
      status,
      decisionNote: text(formData, "decisionNote"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/conges/${requestId}?maj=1`);
}

export async function deleteLeaveRequestAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const requestId = text(formData, "requestId");
  if (!UUID_PATTERN.test(requestId)) {
    return invalid("Demande de congé");
  }
  try {
    await deleteLeaveRequest(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      requestId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/conges?supprime=1");
}
