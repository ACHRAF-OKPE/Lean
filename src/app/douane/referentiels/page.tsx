import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  OfficeForm,
  ReferentialIcon,
  ReferentialToggle,
  RegimeForm,
  TaxForm,
} from "@/components/customs-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { CUSTOMS_REGIME_KIND_LABELS, CUSTOMS_TAX_BASE_LABELS } from "@/modules/customs/constants";
import { listCustomsReferentials } from "@/modules/customs/queries";

export const metadata: Metadata = {
  title: "Référentiels douaniers",
};

const TH = "px-4 py-2.5 font-normal";

export default function CustomsReferentialsPage(props: PageProps<"/douane/referentiels">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des référentiels…" />}>
      <ReferentialsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ReferentialsContent({
  searchParams,
}: Pick<PageProps<"/douane/referentiels">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [referentials, memberships, query] = await Promise.all([
    listCustomsReferentials(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const updated = typeof query.maj === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/douane"
            aria-label="Revenir aux déclarations"
            title="Revenir aux déclarations"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Douane</p>
            <h1 className="text-2xl font-medium tracking-tight">Référentiels douaniers</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Bureaux, régimes et taxes. Un référentiel désactivé reste lisible dans les déclarations
          passées mais ne peut plus être choisi. Les taxes actives entrent dans chaque nouvelle
          liquidation.
        </p>

        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Référentiels mis à jour.
          </p>
        ) : null}

        {!canWrite ? (
          <div className="mt-4 flex gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[11px] leading-5 text-muted">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
            Lecture seule : la modification exige le droit d&apos;écriture.
          </div>
        ) : null}

        <section className="mt-6 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <ReferentialIcon kind="office" />
            <h2 className="text-sm font-semibold">Bureaux de douane</h2>
            <span className="font-mono text-[10px] text-muted">{referentials.offices.length}</span>
          </div>
          {canWrite ? <OfficeForm /> : null}
          {referentials.offices.length === 0 ? (
            <p className="mt-4 text-[11px] text-muted">
              Aucun bureau. Un code UN/LOCODE suffit pour commencer.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Bureaux de douane</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Nom
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Action
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {referentials.offices.map((office) => (
                    <tr key={office.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{office.code}</td>
                      <td className="px-4 py-2.5">{office.name}</td>
                      <td className="px-4 py-2.5">
                        <span className={office.active ? "text-brand" : "text-muted"}>
                          {office.active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <ReferentialToggle
                              kind="office"
                              id={office.id}
                              active={office.active}
                              label={office.code}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <ReferentialIcon kind="regime" />
            <h2 className="text-sm font-semibold">Régimes douaniers</h2>
            <span className="font-mono text-[10px] text-muted">{referentials.regimes.length}</span>
          </div>
          {canWrite ? <RegimeForm /> : null}
          {referentials.regimes.length === 0 ? (
            <p className="mt-4 text-[11px] text-muted">
              Aucun régime. Créez au moins un régime d&apos;importation pour déclarer.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Régimes douaniers</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={TH}>
                      Nature
                    </th>
                    <th scope="col" className={TH}>
                      Acquit
                    </th>
                    <th scope="col" className={TH}>
                      Apurement
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Action
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {referentials.regimes.map((regime) => (
                    <tr key={regime.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{regime.code}</td>
                      <td className="px-4 py-2.5">{regime.label}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {CUSTOMS_REGIME_KIND_LABELS[regime.kind]}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {regime.requiresBond ? "Requis" : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {regime.requiresApurement ? "Progressif" : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={regime.active ? "text-brand" : "text-muted"}>
                          {regime.active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <ReferentialToggle
                              kind="regime"
                              id={regime.id}
                              active={regime.active}
                              label={regime.code}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <ReferentialIcon kind="tax" />
            <h2 className="text-sm font-semibold">Taxes douanières</h2>
            <span className="font-mono text-[10px] text-muted">{referentials.taxes.length}</span>
          </div>
          {canWrite ? <TaxForm /> : null}
          {referentials.taxes.length === 0 ? (
            <p className="mt-4 text-[11px] text-muted">
              Aucune taxe. La liquidation peut se limiter aux droits TEC.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Taxes douanières</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={TH}>
                      Assiette
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Taux
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ordre
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Action
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {referentials.taxes.map((tax) => (
                    <tr key={tax.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{tax.code}</td>
                      <td className="px-4 py-2.5">{tax.label}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {CUSTOMS_TAX_BASE_LABELS[tax.base]}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {(tax.rateBp / 100).toFixed(2).replace(".", ",")} %
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{tax.position}</td>
                      <td className="px-4 py-2.5">
                        <span className={tax.active ? "text-brand" : "text-muted"}>
                          {tax.active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <ReferentialToggle
                              kind="tax"
                              id={tax.id}
                              active={tax.active}
                              label={tax.code}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
