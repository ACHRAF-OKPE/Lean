import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { FiscalYearStatusBadge } from "@/components/accounting-badges";
import { AppHeader } from "@/components/app-header";
import { CloseFiscalYearButton, FiscalYearForm } from "@/components/accounting-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listFiscalYears } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Exercices comptables",
};

const TH = "px-4 py-2.5 font-normal";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function FiscalYearsPage(props: PageProps<"/comptabilite/exercices">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des exercices…" />}>
      <FiscalYearsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function FiscalYearsContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/exercices">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [years, memberships, query] = await Promise.all([
    listFiscalYears(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const created = typeof query.cree === "string";
  const closed = typeof query.clos === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/comptabilite"
            aria-label="Revenir à la comptabilité"
            title="Revenir à la comptabilité"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Comptabilité
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Exercices comptables</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Un exercice couvre 366 jours au plus et ne chevauche aucun autre. Une écriture ne se
          saisit que dans un exercice ouvert ; la clôture exige que tous les brouillons soient
          traités et que les documents de l&apos;exercice soient comptabilisés.
        </p>
        <p className="mt-2 max-w-2xl text-[11px] leading-5 text-muted">
          Clôturer produit deux écritures validées dans le journal d&apos;opérations divers : le
          solde des classes 6, 7 et 8 avec le résultat porté en 131 (bénéfice) ou 139 (perte) au
          dernier jour, puis les à-nouveaux des classes 1 à 5 au premier jour de l&apos;exercice
          suivant. Il faut donc un journal divers actif, le compte 131 ou 139 correspondant au
          résultat, et un exercice ouvert commençant au lendemain de la clôture.
        </p>

        {created ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Exercice créé.
          </p>
        ) : null}
        {closed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Exercice clôturé : il n&apos;accepte plus d&apos;écriture.
          </p>
        ) : null}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Ouvrir un exercice</h2>
            </div>
            <FiscalYearForm today={todayIsoDate()} />
          </section>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {years.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarRange className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun exercice dans cet espace. Ouvrez l&apos;exercice en cours pour démarrer la
                saisie comptable.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Exercices comptables de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Exercice
                    </th>
                    <th scope="col" className={TH}>
                      Début
                    </th>
                    <th scope="col" className={TH}>
                      Fin
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Clôturé le
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Clôturer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-medium">{year.label}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(year.startsOn)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(year.endsOn)}
                      </td>
                      <td className="px-4 py-2.5">
                        <FiscalYearStatusBadge status={year.status} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {year.closedAt ? dateFormatter.format(year.closedAt) : "—"}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          {year.status === "open" ? (
                            <div className="flex justify-end">
                              <CloseFiscalYearButton fiscalYearId={year.id} label={year.label} />
                            </div>
                          ) : (
                            <span className="block text-right text-muted">—</span>
                          )}
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
