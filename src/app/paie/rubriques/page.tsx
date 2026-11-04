import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ListChecks } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import {
  PayrollComponentForm,
  PayrollComponentRenameForm,
  PayrollComponentToggleButton,
} from "@/components/payroll-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listPayrollComponents } from "@/modules/payroll/components";
import {
  PAYROLL_COMPONENT_KIND_LABELS,
  PAYROLL_COMPONENT_MODE_LABELS,
} from "@/modules/payroll/constants";

export const metadata: Metadata = {
  title: "Rubriques de paie",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function PayrollComponentsPage(props: PageProps<"/paie/rubriques">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des rubriques…" />}>
      <PayrollComponentsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PayrollComponentsContent({
  searchParams,
}: Pick<PageProps<"/paie/rubriques">, "searchParams">) {
  await connection();
  const session = await requireModule("payroll", "read");
  const query = await searchParams;
  const db = getDb();
  const [components, memberships, levels] = await Promise.all([
    listPayrollComponents(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canWrite = atLeast(levels.payroll, "write");
  const created = query.cree !== undefined;
  const updated = query.maj !== undefined;

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
            <h1 className="text-2xl font-medium tracking-tight">Rubriques de paie</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque rubrique est un gain ou une retenue, au montant fixe ou au pourcentage. Le code
          reste immuable une fois la rubrique créée ; une rubrique inactive n&apos;entre plus dans
          aucun bulletin, sans effacer l&apos;historique.
        </p>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Rubrique créée.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Rubrique mise à jour.
          </p>
        ) : null}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Nouvelle rubrique</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Une rubrique naît active. Le mode de calcul se choisit à la création.
            </p>
            <PayrollComponentForm />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Registre des rubriques</h2>
            <p className="text-[10px] text-muted">
              {components.length} {components.length > 1 ? "rubriques" : "rubrique"}
            </p>
          </div>
          {components.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune rubrique. Créez un gain ou une retenue pour composer un bulletin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Rubriques de paie de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={TH}>
                      Mode
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Valeur
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((component) => (
                    <tr key={component.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 align-top font-mono text-[10px] whitespace-nowrap">
                        {component.code}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span className="block font-medium">
                          {PAYROLL_COMPONENT_KIND_LABELS[component.kind]}
                        </span>
                        <span className="block text-[10px] text-muted">
                          {component.taxable ? "Imposable" : "Non imposable"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top text-muted">
                        {PAYROLL_COMPONENT_MODE_LABELS[component.mode]}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top whitespace-nowrap tabular-nums">
                        {component.mode === "fixed"
                          ? formatXof(component.amountXof)
                          : `${component.ratePercent} %`}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${
                            component.active
                              ? "border-brand/15 bg-brand-soft text-brand-strong"
                              : "border-line bg-canvas text-muted"
                          }`}
                        >
                          {component.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          {canWrite ? (
                            <PayrollComponentToggleButton
                              componentId={component.id}
                              code={component.code}
                              active={component.active}
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

        {canWrite && components.length > 0 ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Corriger une rubrique</h2>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Le code reste immuable : libellé, valeur et caractère imposable se corrigent ici.
            </p>
            <div className="mt-4 divide-y divide-line">
              {components.map((component) => (
                <div key={component.id} className="py-4 first:pt-0 last:pb-0">
                  <p className="mb-1 font-mono text-[10px] text-muted">{component.code}</p>
                  <PayrollComponentRenameForm
                    componentId={component.id}
                    label={component.label}
                    mode={component.mode}
                    amountXof={component.amountXof}
                    ratePercent={component.ratePercent}
                    taxable={component.taxable}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
