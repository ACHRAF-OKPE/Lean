import { getDb } from "@/db/client";
import { todayIsoDate } from "@/lib/dates";
import { requirePermission } from "@/lib/auth/session";
import { isReportKind, type ReportKind } from "@/modules/reports/constants";
import {
  agedReceivablesFileName,
  buildAgedReceivablesWorkbook,
  buildIncomeStatementWorkbook,
  buildSupplierCommitmentsWorkbook,
  incomeStatementFileName,
  supplierCommitmentsFileName,
} from "@/modules/reports/exports";
import {
  getAgedReceivables,
  getIncomeStatement,
  getSupplierCommitments,
} from "@/modules/reports/queries";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function xlsxResponse(bytes: Uint8Array<ArrayBuffer>, fileName: string): Response {
  return new Response(new Blob([bytes]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function exportResultat(tenantId: string, fiscalYearId: string | null): Promise<Response> {
  if (!fiscalYearId || !UUID_PATTERN.test(fiscalYearId)) {
    return new Response("Exercice invalide.", { status: 404 });
  }
  const report = await getIncomeStatement(getDb(), { tenantId, fiscalYearId });
  if (!report) {
    return new Response("Exercice introuvable dans cet espace.", { status: 404 });
  }
  return xlsxResponse(await buildIncomeStatementWorkbook(report), incomeStatementFileName(report));
}

async function exportBalanceAgee(
  kind: Exclude<ReportKind, "resultat">,
  tenantId: string,
  referenceDate: string,
): Promise<Response> {
  if (kind === "creances") {
    const report = await getAgedReceivables(getDb(), { tenantId, referenceDate });
    return xlsxResponse(
      await buildAgedReceivablesWorkbook(report),
      agedReceivablesFileName(report),
    );
  }
  const report = await getSupplierCommitments(getDb(), { tenantId, referenceDate });
  return xlsxResponse(
    await buildSupplierCommitmentsWorkbook(report),
    supplierCommitmentsFileName(report),
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const session = await requirePermission("data.read");

  if (!isReportKind(slug)) {
    return new Response("État inconnu.", { status: 404 });
  }

  const query = new URL(request.url).searchParams;
  if (slug === "resultat") {
    return exportResultat(session.tenantId, query.get("exercice"));
  }

  const rawDate = query.get("date");
  if (rawDate !== null && !ISO_DATE_PATTERN.test(rawDate)) {
    return new Response("Date invalide.", { status: 400 });
  }
  return exportBalanceAgee(slug, session.tenantId, rawDate ?? todayIsoDate());
}
