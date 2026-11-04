import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { PayrollPeriodForm, PayrollPeriodValidateButton } from "@/components/payroll-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { PAYROLL_PERIOD_STATUS_LABELS } from "@/modules/payroll/constants";
import { listPayrollPeriods, payrollPaymentDate } from "@/modules/payroll/periods";
import { loadPayrollSettings } from "@/modules/payroll/settings";

export const metadata: Metadata = {
  title: "Périodes de paie",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function PayrollPeriodsPage(props: PageProps<"/paie/periodes">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des périodes…" />}>
      <PayrollPeriodsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PayrollPeriodsContent({
  searchParams,
}: Pick<PageProps<"/paie/periodes">, "searchParams">) {
  await connection();
  const session = await requireModule("payroll", "read");
  const query = await searchParams;
  const db = getDb();
  const [periods, settings, memberships, levels] = await Promise.all([
    listPayrollPeriods(db, session.tenantId),
    loadPayrollSettings(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canWrite = atLeast(levels.payroll, "write");
  const canManage = atLeast(levels.payroll, "manage");
  const paymentDay = settings?.paymentDayOfMonth ?? 28;
  const created = query.cree !== undefined;
  const validated = query.valide !== undefined;

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
            <h1 className="text-2xl font-medium tracking-tight">Périodes de paie</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Une période couvre un mois civil : un seul enregistrement par mois et par espace. Elle
          naît en brouillon, reçoit les bulletins du mois, puis se valide une seule fois. La
          validation fige la période. La date de paiement se déduit du jour de paiement paramétré,
          ramené au dernier jour du mois.
        </p>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Période ouverte.
          </p>
        ) : null}
        {validated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Période validée.
          </p>
        ) : null}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Ouvrir une période</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Choisissez l&apos;année et le mois. Un mois déjà ouvert ne peut pas l&apos;être deux
              fois.
            </p>
            <PayrollPeriodForm />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Registre des périodes</h2>
            <p className="text-[10px] text-muted">
              {periods.length} {periods.length > 1 ? "périodes" : "période"}
            </p>
          </div>
          {periods.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune période. Ouvrez un mois pour y préparer les bulletins.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Périodes de paie de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Période
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Paiement prévu
                    </th>
                    <th scope="col" className={TH}>
                      Validée le
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 align-top font-medium whitespace-nowrap">
                        {period.label}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${
                            period.status === "validated"
                              ? "border-brand/15 bg-brand-soft text-brand-strong"
                              : "border-copper/20 bg-copper-soft text-copper"
                          }`}
                        >
                          {PAYROLL_PERIOD_STATUS_LABELS[period.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap tabular-nums">
                        {isoDateLabel(payrollPaymentDate(period.year, period.month, paymentDay))}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap tabular-nums">
                        {period.validatedAt
                          ? isoDateLabel(period.validatedAt.toISOString().slice(0, 10))
                          : "·"}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && period.status === "draft" ? (
                            <PayrollPeriodValidateButton
                              periodId={period.id}
                              label={period.label}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!canManage && periods.some((period) => period.status === "draft") ? (
          <p className="mt-3 text-[10px] text-muted">
            Seul un rôle disposant du niveau gestion peut valider une période.
          </p>
        ) : null}
      </main>
    </div>
  );
}
