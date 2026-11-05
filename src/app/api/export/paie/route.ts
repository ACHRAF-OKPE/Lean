import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import {
  buildPayrollPayslipsExport,
  payrollPayslipsExportFileName,
} from "@/modules/payroll/exports";
import { listPayrollPayslips } from "@/modules/payroll/payslips";
import { listPayrollPeriods } from "@/modules/payroll/periods";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PAY-008 — l'export reprend le registre filtré par période, ou l'ensemble des bulletins. */
export async function GET(request: Request): Promise<Response> {
  const session = await requireModule("payroll", "read");

  const rawPeriod = new URL(request.url).searchParams.get("periode");
  if (rawPeriod !== null && !UUID_PATTERN.test(rawPeriod)) {
    return new Response("Période invalide.", { status: 400 });
  }
  const periodId = rawPeriod ?? null;

  const db = getDb();
  const payslips = await listPayrollPayslips(db, session.tenantId, periodId ? { periodId } : {});
  const periodLabel = periodId
    ? ((await listPayrollPeriods(db, session.tenantId)).find((period) => period.id === periodId)
        ?.label ?? null)
    : null;

  const bytes = await buildPayrollPayslipsExport(payslips, periodLabel);

  return new Response(new Blob([bytes]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${payrollPayslipsExportFileName(periodLabel)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
