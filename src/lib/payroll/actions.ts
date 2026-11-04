"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import {
  createPayrollComponent,
  setPayrollComponentActive,
  updatePayrollComponent,
} from "@/modules/payroll/components";
import { PayrollError } from "@/modules/payroll/errors";
import { createPayrollPeriod, validatePayrollPeriod } from "@/modules/payroll/periods";
import { savePayrollSettings } from "@/modules/payroll/settings";
import type { PayrollFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): PayrollFormState {
  if (error instanceof PayrollError) {
    return { errors: [error.message] };
  }
  throw error;
}

function invalid(label: string): PayrollFormState {
  return { errors: [`${label} invalide.`] };
}

/* ------------------------------------------------------------------ rubriques */

export async function createPayrollComponentAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "write");
  try {
    await createPayrollComponent(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        label: text(formData, "label"),
        kind: text(formData, "kind"),
        mode: text(formData, "mode"),
        amountXof: text(formData, "amountXof"),
        ratePercent: text(formData, "ratePercent"),
        taxable: formData.get("taxable") !== null,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/rubriques?cree=1");
}

export async function updatePayrollComponentAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "write");
  const componentId = text(formData, "componentId");
  if (!UUID_PATTERN.test(componentId)) {
    return invalid("Rubrique");
  }
  try {
    await updatePayrollComponent(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      componentId,
      raw: {
        label: text(formData, "label"),
        amountXof: text(formData, "amountXof"),
        ratePercent: text(formData, "ratePercent"),
        taxable: formData.get("taxable") !== null,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/rubriques?maj=1");
}

export async function setPayrollComponentActiveAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "write");
  const componentId = text(formData, "componentId");
  if (!UUID_PATTERN.test(componentId)) {
    return invalid("Rubrique");
  }
  try {
    await setPayrollComponentActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      componentId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/rubriques?maj=1");
}

/* ------------------------------------------------------------------ périodes */

export async function createPayrollPeriodAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "write");
  try {
    await createPayrollPeriod(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        year: text(formData, "year"),
        month: text(formData, "month"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/periodes?cree=1");
}

export async function validatePayrollPeriodAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "manage");
  const periodId = text(formData, "periodId");
  if (!UUID_PATTERN.test(periodId)) {
    return invalid("Période");
  }
  try {
    await validatePayrollPeriod(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      periodId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/periodes?valide=1");
}

/* ------------------------------------------------------------------ paramétrage */

export async function savePayrollSettingsAction(
  _state: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const session = await requireModule("payroll", "manage");
  try {
    await savePayrollSettings(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        paymentDayOfMonth: text(formData, "paymentDayOfMonth"),
        socialEmployeeRate: text(formData, "socialEmployeeRate"),
        socialEmployerRate: text(formData, "socialEmployerRate"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/paie/parametres?enregistre=1");
}
