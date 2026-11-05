import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Calculator, Download, ReceiptText } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import {
  PayrollPayslipDeleteButton,
  PayrollPayslipGenerateForm,
  PayrollPayslipValidateButton,
} from "@/components/payroll-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { PAYROLL_PAYSLIP_STATUS_LABELS } from "@/modules/payroll/constants";
import { listPayrollPayslips } from "@/modules/payroll/payslips";
import { listPayrollPeriods } from "@/modules/payroll/periods";

export const metadata: Metadata = {
  title: "Bulletins de paie",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PayrollPayslipsPage(props: PageProps<"/paie/bulletins">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des bulletins…" />}>
      <PayrollPayslipsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PayrollPayslipsContent({
  searchParams,
}: Pick<PageProps<"/paie/bulletins">, "searchParams">) {
  await connection();
  const session = await requireModule("payroll", "read");
  const query = await searchParams;
  const db = getDb();

  const rawPeriod = typeof query.periode === "string" ? query.periode : "";
  const periodFilter = UUID_PATTERN.test(rawPeriod) ? rawPeriod : null;

  const [periods, payslips, memberships, levels] = await Promise.all([
    listPayrollPeriods(db, session.tenantId),
    listPayrollPayslips(db, session.tenantId, periodFilter ? { periodId: periodFilter } : {}),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);

  const canWrite = atLeast(levels.payroll, "write");
  const canManage = atLeast(levels.payroll, "manage");
  const draftPeriods = periods
    .filter((period) => period.status === "draft")
    .map((period) => ({ id: period.id, label: period.label }));

  const generated = query.genere !== undefined;
  const validated = query.valide !== undefined;
  const deleted = query.supprime !== undefined;

  const totalNet = payslips.reduce((total, payslip) => total + payslip.netXof, 0);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="payroll" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/paie"
            aria-label="Revenir à la paie"
            title="Revenir à la paie"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Paie</p>
            <h1 className="text-2xl font-medium tracking-tight">Bulletins de paie</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Un bulletin se génère pour un contrat en cours sur une période en brouillon. Il naît
          brouillon, puis se valide une seule fois : la validation le fige, seule la suppression
          d&apos;un brouillon le retire du registre.
        </p>

        {generated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Bulletins générés.
          </p>
        ) : null}
        {validated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Bulletin validé.
          </p>
        ) : null}
        {deleted ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Bulletin supprimé.
          </p>
        ) : null}

        {canWrite && draftPeriods.length > 0 ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Calculator className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Générer les bulletins</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Un bulletin par contrat en cours. Relancer la génération n&apos;ajoute que les
              contrats encore sans bulletin.
            </p>
            <PayrollPayslipGenerateForm periods={draftPeriods} />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ReceiptText className="size-4 text-brand" aria-hidden="true" />
              Registre des bulletins
            </h2>
            <div className="flex items-center gap-2">
              <a
                href={`/api/export/paie${periodFilter ? `?periode=${periodFilter}` : ""}`}
                aria-label="Exporter les bulletins en XLSX"
                title="Exporter en XLSX"
                className={ACTION_LINK}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
              <form method="get" className="flex items-center gap-2">
                <label htmlFor="payslip-filter" className="sr-only">
                  Filtrer par période
                </label>
                <select
                  id="payslip-filter"
                  name="periode"
                  defaultValue={periodFilter ?? ""}
                  className="rounded-md border border-line bg-panel px-2 py-1 text-[11px]"
                >
                  <option value="">Toutes les périodes</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  aria-label="Filtrer les bulletins"
                  title="Filtrer"
                  className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-muted transition-colors hover:border-brand/30 hover:text-brand"
                >
                  Filtrer
                </button>
              </form>
            </div>
          </div>

          {payslips.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun bulletin. Ouvrez une période, puis générez les bulletins du mois.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <caption className="sr-only">Bulletins de paie de l&apos;espace</caption>
                  <thead>
                    <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                      <th scope="col" className={TH}>
                        Salarié
                      </th>
                      <th scope="col" className={TH}>
                        Période
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Brut
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Net
                      </th>
                      <th scope="col" className={TH}>
                        Statut
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((payslip) => (
                      <tr key={payslip.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5 align-top">
                          <Link
                            href={`/paie/bulletins/${payslip.id}`}
                            className="font-medium hover:text-brand"
                          >
                            {payslip.employeeName}
                          </Link>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted">
                            {payslip.employeeCode}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 align-top whitespace-nowrap">
                          {payslip.periodLabel}
                        </td>
                        <td className="px-4 py-2.5 text-right align-top whitespace-nowrap tabular-nums">
                          {formatXof(payslip.grossXof)}
                        </td>
                        <td className="px-4 py-2.5 text-right align-top font-medium whitespace-nowrap tabular-nums">
                          {formatXof(payslip.netXof)}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${
                              payslip.status === "validated"
                                ? "border-brand/15 bg-brand-soft text-brand-strong"
                                : "border-copper/20 bg-copper-soft text-copper"
                            }`}
                          >
                            {PAYROLL_PAYSLIP_STATUS_LABELS[payslip.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <div className="flex items-center justify-end gap-1.5">
                            {canManage && payslip.status === "draft" ? (
                              <PayrollPayslipValidateButton
                                payslipId={payslip.id}
                                label={payslip.employeeName}
                              />
                            ) : null}
                            {canManage && payslip.status === "draft" ? (
                              <PayrollPayslipDeleteButton
                                payslipId={payslip.id}
                                label={payslip.employeeName}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[11px]">
                <p className="text-muted">
                  {payslips.length} {payslips.length > 1 ? "bulletins" : "bulletin"}
                </p>
                <p className="tabular-nums">
                  Total net&nbsp;: <span className="font-medium">{formatXof(totalNet)}</span>
                </p>
              </div>
            </>
          )}
        </section>

        {!canWrite && periods.length === 0 ? (
          <p className="mt-3 text-[10px] text-muted">
            Ouvrez une période depuis l&apos;écran des périodes pour préparer des bulletins.
          </p>
        ) : null}
      </main>
    </div>
  );
}
