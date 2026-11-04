import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, payrollPeriods, type PayrollPeriodStatus } from "@/db/schema";
import { MAX_PAYROLL_YEAR, MIN_PAYROLL_YEAR, payrollPeriodLabel } from "./constants";
import { PayrollError } from "./errors";
import { countDraftPayslips } from "./payslips";

export interface PayrollPeriodSummary {
  readonly id: string;
  readonly year: number;
  readonly month: number;
  readonly label: string;
  readonly status: PayrollPeriodStatus;
  readonly validatedAt: Date | null;
  readonly validatedByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toSummary(row: {
  id: string;
  year: number;
  month: number;
  status: PayrollPeriodStatus;
  validatedAt: Date | null;
  validatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PayrollPeriodSummary {
  return { ...row, label: payrollPeriodLabel(row.year, row.month) };
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function parseYear(raw: unknown): number {
  const text = textOf(raw);
  if (!/^\d{4}$/.test(text)) {
    throw new PayrollError(
      `Année : quatre chiffres entre ${MIN_PAYROLL_YEAR} et ${MAX_PAYROLL_YEAR}.`,
    );
  }
  const value = Number(text);
  if (value < MIN_PAYROLL_YEAR || value > MAX_PAYROLL_YEAR) {
    throw new PayrollError(
      `Année : quatre chiffres entre ${MIN_PAYROLL_YEAR} et ${MAX_PAYROLL_YEAR}.`,
    );
  }
  return value;
}

function parseMonth(raw: unknown): number {
  const text = textOf(raw);
  if (!/^\d{1,2}$/.test(text)) {
    throw new PayrollError("Mois : nombre entier entre 1 et 12.");
  }
  const value = Number(text);
  if (value < 1 || value > 12) {
    throw new PayrollError("Mois : nombre entier entre 1 et 12.");
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/**
 * PAY-005 — la date de paiement se déduit du jour de paiement paramétré, ramené au dernier jour
 * du mois quand le mois est plus court : le 31 devient le 28 ou le 29 en février.
 */
export function payrollPaymentDate(year: number, month: number, dayOfMonth: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(dayOfMonth, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** PAY-005 — le registre des périodes, la plus récente d'abord. */
export async function listPayrollPeriods(
  db: Database,
  tenantId: string,
): Promise<readonly PayrollPeriodSummary[]> {
  const rows = await db
    .select({
      id: payrollPeriods.id,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      status: payrollPeriods.status,
      validatedAt: payrollPeriods.validatedAt,
      validatedByUserId: payrollPeriods.validatedByUserId,
      createdAt: payrollPeriods.createdAt,
      updatedAt: payrollPeriods.updatedAt,
    })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.tenantId, tenantId))
    .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month));
  return rows.map(toSummary);
}

export async function getPayrollPeriod(
  db: Database,
  tenantId: string,
  periodId: string,
): Promise<PayrollPeriodSummary | null> {
  const [row] = await db
    .select({
      id: payrollPeriods.id,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      status: payrollPeriods.status,
      validatedAt: payrollPeriods.validatedAt,
      validatedByUserId: payrollPeriods.validatedByUserId,
      createdAt: payrollPeriods.createdAt,
      updatedAt: payrollPeriods.updatedAt,
    })
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.id, periodId)))
    .limit(1);
  return row ? toSummary(row) : null;
}

/** PAY-005 — une période se crée par son année et son mois, sans autre saisie. */
export interface CreatePayrollPeriodInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: { readonly year: unknown; readonly month: unknown };
}

/** PAY-005 — un mois civil n'a qu'une période par espace ; la période naît en brouillon. */
export async function createPayrollPeriod(
  db: Database,
  input: CreatePayrollPeriodInput,
): Promise<{ id: string }> {
  const year = parseYear(input.raw.year);
  const month = parseMonth(input.raw.month);

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: payrollPeriods.id })
        .from(payrollPeriods)
        .where(
          and(
            eq(payrollPeriods.tenantId, input.tenantId),
            eq(payrollPeriods.year, year),
            eq(payrollPeriods.month, month),
          ),
        )
        .limit(1);
      if (existing) {
        throw new PayrollError(`La période ${payrollPeriodLabel(year, month)} existe déjà.`);
      }

      const [created] = await tx
        .insert(payrollPeriods)
        .values({
          tenantId: input.tenantId,
          year,
          month,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: payrollPeriods.id });
      if (!created) {
        throw new PayrollError("La période de paie n'a pas pu être créée.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "payroll.period.create",
        entityType: "payroll_periods",
        entityId: created.id,
        details: { year, month, label: payrollPeriodLabel(year, month) },
      });

      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PayrollError(`La période ${payrollPeriodLabel(year, month)} existe déjà.`);
    }
    throw error;
  }
}

export interface ValidatePayrollPeriodInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly periodId: string;
}

/**
 * PAY-005 — la validation fige la période une fois pour toutes : elle trace l'acteur et
 * l'horodatage, et une période déjà validée ne réécrit rien. PAY-007 — elle refuse tant qu'un
 * bulletin de la période reste en brouillon.
 */
export async function validatePayrollPeriod(
  db: Database,
  input: ValidatePayrollPeriodInput,
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const [period] = await tx
      .select({
        id: payrollPeriods.id,
        year: payrollPeriods.year,
        month: payrollPeriods.month,
        status: payrollPeriods.status,
      })
      .from(payrollPeriods)
      .where(
        and(eq(payrollPeriods.tenantId, input.tenantId), eq(payrollPeriods.id, input.periodId)),
      )
      .limit(1)
      .for("update");
    if (!period) {
      throw new PayrollError("Période introuvable dans cet espace.");
    }
    if (period.status === "validated") {
      return { changed: false };
    }

    const drafts = await countDraftPayslips(tx, input.tenantId, input.periodId);
    if (drafts > 0) {
      throw new PayrollError(
        `La période compte encore ${drafts} bulletin${drafts > 1 ? "s" : ""} en brouillon : validez-les ou supprimez-les avant de figer la période.`,
      );
    }

    const now = new Date();
    await tx
      .update(payrollPeriods)
      .set({
        status: "validated",
        validatedAt: now,
        validatedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(
        and(eq(payrollPeriods.tenantId, input.tenantId), eq(payrollPeriods.id, input.periodId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.period.validate",
      entityType: "payroll_periods",
      entityId: input.periodId,
      details: {
        year: period.year,
        month: period.month,
        label: payrollPeriodLabel(period.year, period.month),
      },
    });

    return { changed: true };
  });
}
