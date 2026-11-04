import { and, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { hrContracts, payrollComponents, payrollPeriods } from "@/db/schema";

export interface PayrollOverview {
  readonly runningContracts: number;
  readonly activeComponents: number;
  readonly draftPeriods: number;
}

/**
 * PAY-002 — le hub compte les contrats en cours, les rubriques actives et les périodes restées en
 * brouillon, recalculés à la lecture.
 */
export async function getPayrollOverview(db: Database, tenantId: string): Promise<PayrollOverview> {
  const [[contracts], [components], [periods]] = await Promise.all([
    db
      .select({ total: count() })
      .from(hrContracts)
      .where(and(eq(hrContracts.tenantId, tenantId), eq(hrContracts.status, "running"))),
    db
      .select({ total: count() })
      .from(payrollComponents)
      .where(and(eq(payrollComponents.tenantId, tenantId), eq(payrollComponents.active, true))),
    db
      .select({ total: count() })
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.status, "draft"))),
  ]);

  return {
    runningContracts: Number(contracts?.total ?? 0),
    activeComponents: Number(components?.total ?? 0),
    draftPeriods: Number(periods?.total ?? 0),
  };
}
