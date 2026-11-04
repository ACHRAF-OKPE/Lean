import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrContracts,
  hrEmployees,
  payrollComponents,
  payrollPayslipLines,
  payrollPayslips,
  payrollPeriods,
  type PayrollComponentKind,
  type PayrollComponentMode,
  type PayrollPayslipStatus,
} from "@/db/schema";
import { employeeFullName } from "@/modules/hr/validation";
import { MAX_PAYSLIP_AMOUNT_XOF, payrollPeriodLabel } from "./constants";
import { PayrollError } from "./errors";
import { loadPayrollSettings } from "./settings";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Transaction;

export interface PayslipComponentInput {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: PayrollComponentKind;
  readonly mode: PayrollComponentMode;
  readonly amountXof: number;
  readonly ratePercent: string;
  readonly taxable: boolean;
}

export interface PayslipLineSnapshot {
  readonly componentId: string;
  readonly code: string;
  readonly label: string;
  readonly kind: PayrollComponentKind;
  readonly mode: PayrollComponentMode;
  readonly ratePercent: string;
  readonly amountXof: number;
  readonly taxable: boolean;
  readonly sortOrder: number;
}

export interface PayslipComputation {
  readonly baseSalaryXof: number;
  readonly grossXof: number;
  readonly socialEmployeeXof: number;
  readonly socialEmployerXof: number;
  readonly deductionsXof: number;
  readonly netXof: number;
  readonly lines: readonly PayslipLineSnapshot[];
}

/** Un arrondi au franc le plus proche ; les montants sont positifs, donc l'arrondi est HALF_UP. */
function roundHalfUp(value: number): number {
  return Math.round(value);
}

function rateOf(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * PAY-006 — un bulletin part du salaire de base du contrat. Chaque rubrique active y entre : un gain
 * au montant fixe s'ajoute tel quel, une rubrique au pourcentage s'applique au salaire de base. Le
 * brut est le salaire de base augmenté des gains, avant toute retenue. Les cotisations salariale et
 * patronale se calculent sur le brut ; le net déduit du brut la cotisation salariale et les retenues.
 */
export function computePayslip(input: {
  readonly baseSalaryXof: number;
  readonly components: readonly PayslipComponentInput[];
  readonly socialEmployeeRate: string;
  readonly socialEmployerRate: string;
}): PayslipComputation {
  const baseSalaryXof = Math.max(0, Math.trunc(input.baseSalaryXof));

  const lines = input.components.map((component, index) => {
    const amountXof =
      component.mode === "percent"
        ? roundHalfUp((baseSalaryXof * rateOf(component.ratePercent)) / 100)
        : component.amountXof;
    return {
      componentId: component.id,
      code: component.code,
      label: component.label,
      kind: component.kind,
      mode: component.mode,
      ratePercent: component.ratePercent,
      amountXof,
      taxable: component.taxable,
      sortOrder: index,
    } satisfies PayslipLineSnapshot;
  });

  const earnings = lines
    .filter((line) => line.kind === "earning")
    .reduce((total, line) => total + line.amountXof, 0);
  const deductionsXof = lines
    .filter((line) => line.kind === "deduction")
    .reduce((total, line) => total + line.amountXof, 0);

  const grossXof = baseSalaryXof + earnings;
  if (grossXof > MAX_PAYSLIP_AMOUNT_XOF) {
    throw new PayrollError(`Brut du bulletin : ${MAX_PAYSLIP_AMOUNT_XOF} XOF maximum.`);
  }

  const socialEmployeeXof = roundHalfUp((grossXof * rateOf(input.socialEmployeeRate)) / 100);
  const socialEmployerXof = roundHalfUp((grossXof * rateOf(input.socialEmployerRate)) / 100);
  const netXof = grossXof - socialEmployeeXof - deductionsXof;
  if (netXof < 0) {
    throw new PayrollError(
      "Les retenues et la cotisation salariale dépassent le brut : le net serait négatif.",
    );
  }

  return {
    baseSalaryXof,
    grossXof,
    socialEmployeeXof,
    socialEmployerXof,
    deductionsXof,
    netXof,
    lines,
  };
}

export interface PayrollPayslipSummary {
  readonly id: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly grossXof: number;
  readonly netXof: number;
  readonly status: PayrollPayslipStatus;
  readonly createdAt: Date;
}

export interface PayrollPayslipLineView {
  readonly id: string;
  readonly componentId: string | null;
  readonly code: string;
  readonly label: string;
  readonly kind: PayrollComponentKind;
  readonly mode: PayrollComponentMode;
  readonly ratePercent: string;
  readonly amountXof: number;
  readonly taxable: boolean;
}

export interface PayrollPayslipDetail extends PayrollPayslipSummary {
  readonly year: number;
  readonly month: number;
  readonly contractId: string;
  readonly baseSalaryXof: number;
  readonly socialEmployeeXof: number;
  readonly socialEmployerXof: number;
  readonly deductionsXof: number;
  readonly validatedAt: Date | null;
  readonly lines: readonly PayrollPayslipLineView[];
}

function normalizeRate(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** PAY-006 — le registre des bulletins, le plus récent d'abord, filtrable par période. */
export async function listPayrollPayslips(
  db: DbLike,
  tenantId: string,
  options: { readonly periodId?: string } = {},
): Promise<readonly PayrollPayslipSummary[]> {
  const conditions = [eq(payrollPayslips.tenantId, tenantId)];
  if (options.periodId) {
    conditions.push(eq(payrollPayslips.periodId, options.periodId));
  }

  const rows = await db
    .select({
      id: payrollPayslips.id,
      periodId: payrollPayslips.periodId,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      employeeId: payrollPayslips.employeeId,
      employeeCode: hrEmployees.code,
      employeeLastName: hrEmployees.lastName,
      employeeFirstName: hrEmployees.firstName,
      grossXof: payrollPayslips.grossXof,
      netXof: payrollPayslips.netXof,
      status: payrollPayslips.status,
      createdAt: payrollPayslips.createdAt,
    })
    .from(payrollPayslips)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.tenantId, payrollPayslips.tenantId),
        eq(payrollPeriods.id, payrollPayslips.periodId),
      ),
    )
    .innerJoin(
      hrEmployees,
      and(
        eq(hrEmployees.tenantId, payrollPayslips.tenantId),
        eq(hrEmployees.id, payrollPayslips.employeeId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month), asc(hrEmployees.code));

  return rows.map((row) => ({
    id: row.id,
    periodId: row.periodId,
    periodLabel: payrollPeriodLabel(row.year, row.month),
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: employeeFullName(row.employeeLastName, row.employeeFirstName),
    grossXof: row.grossXof,
    netXof: row.netXof,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** PAY-006 — la fiche d'un bulletin : ses totaux et le détail de ses rubriques. */
export async function getPayrollPayslip(
  db: DbLike,
  tenantId: string,
  payslipId: string,
): Promise<PayrollPayslipDetail | null> {
  const [row] = await db
    .select({
      id: payrollPayslips.id,
      periodId: payrollPayslips.periodId,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      employeeId: payrollPayslips.employeeId,
      employeeCode: hrEmployees.code,
      employeeLastName: hrEmployees.lastName,
      employeeFirstName: hrEmployees.firstName,
      contractId: payrollPayslips.contractId,
      baseSalaryXof: payrollPayslips.baseSalaryXof,
      grossXof: payrollPayslips.grossXof,
      socialEmployeeXof: payrollPayslips.socialEmployeeXof,
      socialEmployerXof: payrollPayslips.socialEmployerXof,
      deductionsXof: payrollPayslips.deductionsXof,
      netXof: payrollPayslips.netXof,
      status: payrollPayslips.status,
      validatedAt: payrollPayslips.validatedAt,
      createdAt: payrollPayslips.createdAt,
    })
    .from(payrollPayslips)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.tenantId, payrollPayslips.tenantId),
        eq(payrollPeriods.id, payrollPayslips.periodId),
      ),
    )
    .innerJoin(
      hrEmployees,
      and(
        eq(hrEmployees.tenantId, payrollPayslips.tenantId),
        eq(hrEmployees.id, payrollPayslips.employeeId),
      ),
    )
    .where(and(eq(payrollPayslips.tenantId, tenantId), eq(payrollPayslips.id, payslipId)))
    .limit(1);
  if (!row) {
    return null;
  }

  const lines = await db
    .select({
      id: payrollPayslipLines.id,
      componentId: payrollPayslipLines.componentId,
      code: payrollPayslipLines.code,
      label: payrollPayslipLines.label,
      kind: payrollPayslipLines.kind,
      mode: payrollPayslipLines.mode,
      ratePercent: payrollPayslipLines.ratePercent,
      amountXof: payrollPayslipLines.amountXof,
      taxable: payrollPayslipLines.taxable,
    })
    .from(payrollPayslipLines)
    .where(
      and(eq(payrollPayslipLines.tenantId, tenantId), eq(payrollPayslipLines.payslipId, payslipId)),
    )
    .orderBy(asc(payrollPayslipLines.sortOrder), asc(payrollPayslipLines.code));

  return {
    id: row.id,
    periodId: row.periodId,
    periodLabel: payrollPeriodLabel(row.year, row.month),
    year: row.year,
    month: row.month,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: employeeFullName(row.employeeLastName, row.employeeFirstName),
    contractId: row.contractId,
    baseSalaryXof: row.baseSalaryXof,
    grossXof: row.grossXof,
    socialEmployeeXof: row.socialEmployeeXof,
    socialEmployerXof: row.socialEmployerXof,
    deductionsXof: row.deductionsXof,
    netXof: row.netXof,
    status: row.status,
    validatedAt: row.validatedAt,
    createdAt: row.createdAt,
    lines: lines.map((line) => ({ ...line, ratePercent: normalizeRate(line.ratePercent) })),
  };
}

/** PAY-007 — une période ne se valide pas tant qu'un de ses bulletins reste en brouillon. */
export async function countDraftPayslips(
  db: DbLike,
  tenantId: string,
  periodId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(payrollPayslips)
    .where(
      and(
        eq(payrollPayslips.tenantId, tenantId),
        eq(payrollPayslips.periodId, periodId),
        eq(payrollPayslips.status, "draft"),
      ),
    );
  return Number(row?.total ?? 0);
}

export interface GeneratePayrollPayslipsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly periodId: string;
}

export interface GeneratePayrollPayslipsResult {
  readonly created: number;
  readonly skipped: number;
}

/**
 * PAY-006 — la génération remplit une période en brouillon : un bulletin par contrat en cours, avec
 * l'instantané des rubriques actives et le calcul brut / net. Relancée, elle ne double aucun
 * bulletin et n'ajoute que les contrats manquants.
 */
export async function generatePayrollPayslips(
  db: Database,
  input: GeneratePayrollPayslipsInput,
): Promise<GeneratePayrollPayslipsResult> {
  return db.transaction(async (tx) => {
    const [period] = await tx
      .select({ id: payrollPeriods.id, status: payrollPeriods.status })
      .from(payrollPeriods)
      .where(
        and(eq(payrollPeriods.tenantId, input.tenantId), eq(payrollPeriods.id, input.periodId)),
      )
      .limit(1);
    if (!period) {
      throw new PayrollError("Période introuvable dans cet espace.");
    }
    if (period.status === "validated") {
      throw new PayrollError("Période validée : elle est figée et n'accueille plus de bulletin.");
    }

    const contracts = await tx
      .select({
        id: hrContracts.id,
        employeeId: hrContracts.employeeId,
        salaryXof: hrContracts.salaryXof,
      })
      .from(hrContracts)
      .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.status, "running")))
      .orderBy(asc(hrContracts.employeeId));

    const existing = await tx
      .select({ employeeId: payrollPayslips.employeeId })
      .from(payrollPayslips)
      .where(
        and(
          eq(payrollPayslips.tenantId, input.tenantId),
          eq(payrollPayslips.periodId, input.periodId),
        ),
      );
    const already = new Set(existing.map((row) => row.employeeId));

    const components = await tx
      .select({
        id: payrollComponents.id,
        code: payrollComponents.code,
        label: payrollComponents.label,
        kind: payrollComponents.kind,
        mode: payrollComponents.mode,
        amountXof: payrollComponents.amountXof,
        ratePercent: payrollComponents.ratePercent,
        taxable: payrollComponents.taxable,
      })
      .from(payrollComponents)
      .where(
        and(eq(payrollComponents.tenantId, input.tenantId), eq(payrollComponents.active, true)),
      )
      .orderBy(asc(payrollComponents.code));

    const settings = await loadPayrollSettings(tx, input.tenantId);
    const socialEmployeeRate = settings?.socialEmployeeRate ?? "0";
    const socialEmployerRate = settings?.socialEmployerRate ?? "0";

    let created = 0;
    let skipped = 0;

    for (const contract of contracts) {
      if (already.has(contract.employeeId)) {
        skipped += 1;
        continue;
      }

      const computation = computePayslip({
        baseSalaryXof: contract.salaryXof,
        components,
        socialEmployeeRate,
        socialEmployerRate,
      });

      const [payslip] = await tx
        .insert(payrollPayslips)
        .values({
          tenantId: input.tenantId,
          periodId: input.periodId,
          employeeId: contract.employeeId,
          contractId: contract.id,
          baseSalaryXof: computation.baseSalaryXof,
          grossXof: computation.grossXof,
          socialEmployeeXof: computation.socialEmployeeXof,
          socialEmployerXof: computation.socialEmployerXof,
          deductionsXof: computation.deductionsXof,
          netXof: computation.netXof,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: payrollPayslips.id });
      if (!payslip) {
        throw new PayrollError("Le bulletin n'a pas pu être créé.");
      }

      if (computation.lines.length > 0) {
        await tx.insert(payrollPayslipLines).values(
          computation.lines.map((line) => ({
            tenantId: input.tenantId,
            payslipId: payslip.id,
            componentId: line.componentId,
            code: line.code,
            label: line.label,
            kind: line.kind,
            mode: line.mode,
            ratePercent: line.ratePercent,
            amountXof: line.amountXof,
            taxable: line.taxable,
            sortOrder: line.sortOrder,
          })),
        );
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "payroll.payslip.generate",
        entityType: "payroll_payslips",
        entityId: payslip.id,
        details: {
          periodId: input.periodId,
          employeeId: contract.employeeId,
          grossXof: computation.grossXof,
          netXof: computation.netXof,
        },
      });

      created += 1;
    }

    return { created, skipped };
  });
}

export interface ValidatePayrollPayslipInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly payslipId: string;
}

/** PAY-007 — un bulletin naît brouillon et se valide une seule fois : la validation le fige. */
export async function validatePayrollPayslip(
  db: Database,
  input: ValidatePayrollPayslipInput,
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const [payslip] = await tx
      .select({ id: payrollPayslips.id, status: payrollPayslips.status })
      .from(payrollPayslips)
      .where(
        and(eq(payrollPayslips.tenantId, input.tenantId), eq(payrollPayslips.id, input.payslipId)),
      )
      .limit(1)
      .for("update");
    if (!payslip) {
      throw new PayrollError("Bulletin introuvable dans cet espace.");
    }
    if (payslip.status === "validated") {
      return { changed: false };
    }

    await tx
      .update(payrollPayslips)
      .set({
        status: "validated",
        validatedAt: new Date(),
        validatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(payrollPayslips.tenantId, input.tenantId), eq(payrollPayslips.id, input.payslipId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.payslip.validate",
      entityType: "payroll_payslips",
      entityId: input.payslipId,
    });

    return { changed: true };
  });
}

export interface DeletePayrollPayslipInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly payslipId: string;
}

/** PAY-007 — seul un bulletin en brouillon se supprime ; un bulletin validé reste au registre. */
export async function deletePayrollPayslip(
  db: Database,
  input: DeletePayrollPayslipInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [payslip] = await tx
      .select({ id: payrollPayslips.id, status: payrollPayslips.status })
      .from(payrollPayslips)
      .where(
        and(eq(payrollPayslips.tenantId, input.tenantId), eq(payrollPayslips.id, input.payslipId)),
      )
      .limit(1)
      .for("update");
    if (!payslip) {
      throw new PayrollError("Bulletin introuvable dans cet espace.");
    }
    if (payslip.status === "validated") {
      throw new PayrollError("Un bulletin validé ne se supprime pas.");
    }

    await tx
      .delete(payrollPayslips)
      .where(
        and(eq(payrollPayslips.tenantId, input.tenantId), eq(payrollPayslips.id, input.payslipId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.payslip.delete",
      entityType: "payroll_payslips",
      entityId: input.payslipId,
    });
  });
}
