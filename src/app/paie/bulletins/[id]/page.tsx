import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ReceiptText, Wallet } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import {
  PayrollPayslipDeleteButton,
  PayrollPayslipValidateButton,
} from "@/components/payroll-forms";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  PAYROLL_COMPONENT_KIND_LABELS,
  PAYROLL_COMPONENT_MODE_LABELS,
  PAYROLL_PAYSLIP_STATUS_LABELS,
} from "@/modules/payroll/constants";
import { getPayrollPayslip } from "@/modules/payroll/payslips";

export const metadata: Metadata = {
  title: "Bulletin de paie",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const LABEL = "font-mono text-[10px] tracking-[0.12em] text-muted uppercase";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PayrollPayslipPage(props: PageProps<"/paie/bulletins/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du bulletin…" />}>
      <PayrollPayslipContent params={props.params} />
    </Suspense>
  );
}

async function PayrollPayslipContent({
  params,
}: Pick<PageProps<"/paie/bulletins/[id]">, "params">) {
  await connection();
  const session = await requireModule("payroll", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [payslip, canManage] = await Promise.all([
    getPayrollPayslip(db, session.tenantId, id),
    canAccessModule(session, "payroll", "manage"),
  ]);
  if (!payslip) {
    notFound();
  }

  const memberships = await listMembershipsForUser(db, session.userId);
  const draft = payslip.status === "draft";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="payroll" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href={`/paie/bulletins?periode=${payslip.periodId}`}
            aria-label="Revenir aux bulletins"
            title="Revenir aux bulletins"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Bulletin de paie
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {payslip.employeeName}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
              <span>{payslip.employeeCode}</span>
              <span>·</span>
              <span>{payslip.periodLabel}</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
                  payslip.status === "validated"
                    ? "border-brand/15 bg-brand-soft text-brand-strong"
                    : "border-copper/20 bg-copper-soft text-copper"
                }`}
              >
                {PAYROLL_PAYSLIP_STATUS_LABELS[payslip.status]}
              </span>
            </p>
          </div>
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Wallet className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Totaux</h2>
          </div>
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div>
              <dt className={LABEL}>Salaire de base</dt>
              <dd className="mt-1 text-[11px] tabular-nums">{formatXof(payslip.baseSalaryXof)}</dd>
            </div>
            <div>
              <dt className={LABEL}>Brut</dt>
              <dd className="mt-1 text-[11px] font-medium tabular-nums">
                {formatXof(payslip.grossXof)}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Cotisation salariale</dt>
              <dd className="mt-1 text-[11px] tabular-nums">
                {formatXof(payslip.socialEmployeeXof)}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Cotisation patronale</dt>
              <dd className="mt-1 text-[11px] tabular-nums">
                {formatXof(payslip.socialEmployerXof)}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Retenues</dt>
              <dd className="mt-1 text-[11px] tabular-nums">{formatXof(payslip.deductionsXof)}</dd>
            </div>
            <div>
              <dt className={LABEL}>Net à payer</dt>
              <dd className="mt-1 text-[11px] font-medium tabular-nums">
                {formatXof(payslip.netXof)}
              </dd>
            </div>
          </dl>
          {payslip.validatedAt ? (
            <div className="border-t border-line px-4 py-3">
              <p className={LABEL}>Validation</p>
              <p className="mt-1 text-[11px]">
                Bulletin validé le{" "}
                {new Intl.DateTimeFormat("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "Africa/Abidjan",
                }).format(payslip.validatedAt)}
                .
              </p>
            </div>
          ) : null}
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <ReceiptText className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Détail des rubriques</h2>
          </div>
          {payslip.lines.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] leading-5 text-muted">
              Aucune rubrique active au moment de la génération : le bulletin ne compte que le
              salaire de base.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Rubriques du bulletin</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Code
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Libellé
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Valeur
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-normal">
                      Montant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payslip.lines.map((line) => (
                    <tr key={line.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 align-top font-mono text-[10px] whitespace-nowrap">
                        {line.code}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {line.label}
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {line.taxable ? "Imposable" : "Non imposable"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top text-muted">
                        {PAYROLL_COMPONENT_KIND_LABELS[line.kind]}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap text-muted">
                        {line.mode === "percent"
                          ? `${line.ratePercent} %`
                          : PAYROLL_COMPONENT_MODE_LABELS.fixed}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top font-medium whitespace-nowrap tabular-nums">
                        {formatXof(line.amountXof)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {draft && canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-sm font-semibold">Décision</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Valider un bulletin le fige et le rend définitif. Supprimer un brouillon le retire du
              registre, par exemple pour régénérer après une correction de rubrique.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PayrollPayslipValidateButton payslipId={payslip.id} label={payslip.employeeName} />
              <PayrollPayslipDeleteButton payslipId={payslip.id} label={payslip.employeeName} />
            </div>
          </section>
        ) : null}

        {draft && !canManage ? (
          <p className="mt-3 text-[10px] text-muted">
            Seul un rôle disposant du niveau gestion peut valider ou supprimer un bulletin.
          </p>
        ) : null}

        <p className="mt-3 text-[10px] text-muted">
          Bulletin généré le {isoDateLabel(payslip.createdAt.toISOString().slice(0, 10))}.
        </p>
      </main>
    </div>
  );
}
