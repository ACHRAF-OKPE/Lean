import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, payrollSettings } from "@/db/schema";
import { MAX_CONTRIBUTION_RATE, PAYROLL_RATE_SCALE } from "./constants";
import { PayrollError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PayrollSettingsRecord {
  readonly id: string;
  readonly paymentDayOfMonth: number;
  readonly socialEmployeeRate: string;
  readonly socialEmployerRate: string;
}

export interface PayrollSettingsView extends PayrollSettingsRecord {
  readonly updatedAt: Date;
}

function normalizeRate(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** PAY-001 — le paramétrage est unique par espace ; son absence vaut valeurs par défaut. */
export async function loadPayrollSettings(
  db: Database | Transaction,
  tenantId: string,
): Promise<PayrollSettingsRecord | null> {
  const [row] = await db
    .select({
      id: payrollSettings.id,
      paymentDayOfMonth: payrollSettings.paymentDayOfMonth,
      socialEmployeeRate: payrollSettings.socialEmployeeRate,
      socialEmployerRate: payrollSettings.socialEmployerRate,
    })
    .from(payrollSettings)
    .where(eq(payrollSettings.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    ...row,
    socialEmployeeRate: normalizeRate(row.socialEmployeeRate),
    socialEmployerRate: normalizeRate(row.socialEmployerRate),
  };
}

export async function getPayrollSettingsView(
  db: Database,
  tenantId: string,
): Promise<PayrollSettingsView | null> {
  const [row] = await db
    .select()
    .from(payrollSettings)
    .where(eq(payrollSettings.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    paymentDayOfMonth: row.paymentDayOfMonth,
    socialEmployeeRate: normalizeRate(row.socialEmployeeRate),
    socialEmployerRate: normalizeRate(row.socialEmployerRate),
    updatedAt: row.updatedAt,
  };
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function parsePaymentDay(raw: unknown): number {
  const text = textOf(raw) || "28";
  if (!/^\d{1,2}$/.test(text)) {
    throw new PayrollError("Jour de paiement : nombre entier entre 1 et 31.");
  }
  const value = Number(text);
  if (value < 1 || value > 31) {
    throw new PayrollError("Jour de paiement : nombre entier entre 1 et 31.");
  }
  return value;
}

function parseRate(raw: unknown, label: string): string {
  let text = textOf(raw);
  if (text === "") {
    text = "0";
  }
  if (text.includes(",") && !text.includes(".")) {
    text = text.replace(",", ".");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new PayrollError(`${label} : taux entre 0 et ${MAX_CONTRIBUTION_RATE}, point décimal.`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > PAYROLL_RATE_SCALE) {
    throw new PayrollError(`${label} : ${PAYROLL_RATE_SCALE} décimales maximum.`);
  }
  const whole = match[1]!.replace(/^0+(?=\d)/, "");
  const value = Number(`${whole || "0"}.${fraction || "0"}`);
  if (value > MAX_CONTRIBUTION_RATE) {
    throw new PayrollError(`${label} : taux entre 0 et ${MAX_CONTRIBUTION_RATE}.`);
  }
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole || "0"}${trimmed ? `.${trimmed}` : ""}`;
}

export interface SavePayrollSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly paymentDayOfMonth: unknown;
    readonly socialEmployeeRate: unknown;
    readonly socialEmployerRate: unknown;
  };
}

/** PAY-001 — un jour de paiement et les taux de cotisation salariale et patronale, en pourcentage. */
export async function savePayrollSettings(
  db: Database,
  input: SavePayrollSettingsInput,
): Promise<{ created: boolean }> {
  const paymentDayOfMonth = parsePaymentDay(input.raw.paymentDayOfMonth);
  const socialEmployeeRate = parseRate(input.raw.socialEmployeeRate, "Taux salarial");
  const socialEmployerRate = parseRate(input.raw.socialEmployerRate, "Taux patronal");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: payrollSettings.id })
      .from(payrollSettings)
      .where(eq(payrollSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      paymentDayOfMonth,
      socialEmployeeRate,
      socialEmployerRate,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(payrollSettings)
      .values(values)
      .onConflictDoUpdate({
        target: payrollSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.settings.update",
      entityType: "payroll_settings",
      entityId: input.tenantId,
      details: {
        created: !existing,
        paymentDayOfMonth,
        socialEmployeeRate,
        socialEmployerRate,
      },
    });

    return { created: !existing };
  });
}
