"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { HrError } from "@/modules/hr/errors";
import {
  createContract,
  createDepartment,
  createEmployee,
  deleteContract,
  deleteEmployee,
  linkEmployeeUser,
  setDepartmentActive,
  startContract,
  terminateContract,
  unlinkEmployeeUser,
  updateContract,
  updateDepartment,
  updateEmployee,
} from "@/modules/hr/queries";
import type { HrFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = text(formData, name).trim();
  return value.length > 0 ? value : undefined;
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

/* -------------------------------------------------------------------- services */

export async function createDepartmentAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  let departmentId: string;
  try {
    const created = await createDepartment(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        name: text(formData, "name"),
        parentId: optionalText(formData, "parentId") ?? "",
        responsibleEmployeeId: optionalText(formData, "responsibleEmployeeId") ?? "",
        active: formData.get("active") !== null,
      },
    });
    departmentId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/organisation/${departmentId}?cree=1`);
}

export async function updateDepartmentAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const departmentId = text(formData, "departmentId");
  if (!UUID_PATTERN.test(departmentId)) {
    return invalid("Service");
  }
  try {
    await updateDepartment(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      departmentId,
      raw: {
        code: text(formData, "code"),
        name: text(formData, "name"),
        parentId: optionalText(formData, "parentId") ?? "",
        responsibleEmployeeId: optionalText(formData, "responsibleEmployeeId") ?? "",
        active: formData.get("active") !== null,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/organisation/${departmentId}?maj=1`);
}

export async function toggleDepartmentActiveAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const departmentId = text(formData, "departmentId");
  if (!UUID_PATTERN.test(departmentId)) {
    return invalid("Service");
  }
  try {
    await setDepartmentActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      departmentId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  redirect(
    text(formData, "detail") === "1"
      ? `/rh/organisation/${departmentId}?maj=1`
      : "/rh/organisation?maj=1",
  );
}

/* ---------------------------------------------------------------- fiches salarié */

export async function createEmployeeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  let employeeId: string;
  try {
    const created = await createEmployee(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        lastName: text(formData, "lastName"),
        firstName: text(formData, "firstName"),
        position: optionalText(formData, "position") ?? "",
        hireDate: text(formData, "hireDate"),
        status: text(formData, "status"),
        departureDate: optionalText(formData, "departureDate") ?? "",
        departmentId: optionalText(formData, "departmentId") ?? "",
        managerEmployeeId: optionalText(formData, "managerEmployeeId") ?? "",
        workCalendarId: optionalText(formData, "workCalendarId") ?? "",
      },
    });
    employeeId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/personnel/${employeeId}?cree=1`);
}

export async function updateEmployeeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const employeeId = text(formData, "employeeId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Fiche salarié");
  }
  try {
    await updateEmployee(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      employeeId,
      raw: {
        code: text(formData, "code"),
        lastName: text(formData, "lastName"),
        firstName: text(formData, "firstName"),
        position: optionalText(formData, "position") ?? "",
        hireDate: text(formData, "hireDate"),
        status: text(formData, "status"),
        departureDate: optionalText(formData, "departureDate") ?? "",
        departmentId: optionalText(formData, "departmentId") ?? "",
        managerEmployeeId: optionalText(formData, "managerEmployeeId") ?? "",
        workCalendarId: optionalText(formData, "workCalendarId") ?? "",
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/personnel/${employeeId}?maj=1`);
}

export async function linkEmployeeUserAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const employeeId = text(formData, "employeeId");
  const userId = text(formData, "userId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Fiche salarié");
  }
  if (!UUID_PATTERN.test(userId)) {
    return { errors: ["Compte invalide : sélectionnez un membre de l'espace."] };
  }
  try {
    await linkEmployeeUser(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      employeeId,
      userId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/personnel/${employeeId}?maj=1`);
}

export async function unlinkEmployeeUserAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const employeeId = text(formData, "employeeId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Fiche salarié");
  }
  try {
    await unlinkEmployeeUser(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      employeeId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/personnel/${employeeId}?maj=1`);
}

export async function deleteEmployeeAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const employeeId = text(formData, "employeeId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Fiche salarié");
  }
  try {
    await deleteEmployee(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      employeeId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/personnel?supprime=1");
}

/* -------------------------------------------------------------------- contrats */

export async function createContractAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  let contractId: string;
  try {
    const created = await createContract(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        employeeId: text(formData, "employeeId"),
        kind: text(formData, "kind"),
        startDate: text(formData, "startDate"),
        endDate: optionalText(formData, "endDate") ?? "",
        trialPeriodDays: optionalText(formData, "trialPeriodDays") ?? "",
        weeklyHours: optionalText(formData, "weeklyHours") ?? "",
        salaryXof: optionalText(formData, "salaryXof") ?? "",
      },
    });
    contractId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/contrats/${contractId}?cree=1`);
}

export async function updateContractAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const contractId = text(formData, "contractId");
  if (!UUID_PATTERN.test(contractId)) {
    return invalid("Contrat");
  }
  try {
    await updateContract(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      contractId,
      raw: {
        employeeId: text(formData, "employeeId"),
        kind: text(formData, "kind"),
        startDate: text(formData, "startDate"),
        endDate: optionalText(formData, "endDate") ?? "",
        trialPeriodDays: optionalText(formData, "trialPeriodDays") ?? "",
        weeklyHours: optionalText(formData, "weeklyHours") ?? "",
        salaryXof: optionalText(formData, "salaryXof") ?? "",
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/contrats/${contractId}?maj=1`);
}

export async function startContractAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const contractId = text(formData, "contractId");
  if (!UUID_PATTERN.test(contractId)) {
    return invalid("Contrat");
  }
  try {
    await startContract(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      contractId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/contrats/${contractId}?maj=1`);
}

export async function terminateContractAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const contractId = text(formData, "contractId");
  if (!UUID_PATTERN.test(contractId)) {
    return invalid("Contrat");
  }
  try {
    await terminateContract(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      contractId,
      terminatedOn: text(formData, "terminatedOn"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/contrats/${contractId}?maj=1`);
}

export async function deleteContractAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const contractId = text(formData, "contractId");
  if (!UUID_PATTERN.test(contractId)) {
    return invalid("Contrat");
  }
  try {
    await deleteContract(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      contractId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/contrats?supprime=1");
}
