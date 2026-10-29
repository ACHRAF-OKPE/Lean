import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, ClipboardList, Clock, SlidersHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listSupplyPolicies, listSupplyRuns } from "@/modules/supply/queries";
import { RunCalculationForm } from "./run-form";

export const metadata: Metadata = {
  title: "Calculs des besoins",
};

const TH = "px-4 py-2.5 font-normal";
const TIMESTAMP = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function SupplyRunsPage(props: PageProps<"/achats/besoins">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des calculs des besoins…" />}>
      <SupplyRunsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SupplyRunsContent({
  searchParams,
}: Pick<PageProps<"/achats/besoins">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const query = await searchParams;
  const db = getDb();
  const [runs, policies, memberships] = await Promise.all([
    listSupplyRuns(db, session.tenantId),
    listSupplyPolicies(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const canWrite = can(session.role, "data.write");
  const activePolicies = policies.rows.filter((row) => row.supplierId && row.active).length;
  const pendingTotal = runs.reduce((sum, run) => sum + run.pendingCount, 0);
  const latest = runs[0] ?? null;
  const calcule = typeof query.calcule === "string" ? query.calcule : null;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="supply" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Achats</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Calculs des besoins</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Le stock projeté article par article, puis des propositions d&apos;achat convertibles
              en commandes fournisseurs brouillon ou en demande de cotation. Chaque calcul est
              numéroté et conservé tel quel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/achats/approvisionnement"
              aria-label="Ouvrir les politiques d'approvisionnement"
              title="Politiques d'approvisionnement"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {calcule ? (
          <p
            role="status"
            className="mt-5 flex gap-2 rounded-md border border-brand/20 bg-brand-soft px-3 py-2.5 text-[11px] leading-5 text-brand-strong"
          >
            <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Calcul {calcule} enregistré.</span>
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Calculs conservés</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{runs.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Propositions en attente</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">{pendingTotal}</dd>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <Clock className="size-4 text-brand" aria-hidden="true" />
            <p className="text-[10px] leading-4 text-muted">
              {latest
                ? `Dernier calcul ${latest.number} le ${TIMESTAMP.format(latest.calculatedAt)}.`
                : "Aucun calcul lancé dans cet espace."}
            </p>
          </div>
        </dl>

        {canWrite ? (
          <div className="mt-5">
            <RunCalculationForm hasPolicies={activePolicies > 0} />
          </div>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {runs.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucun calcul dans cet espace. Définissez les politiques d&apos;approvisionnement, puis
              lancez le premier calcul.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Calculs des besoins de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Calcul
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Horizon
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Articles
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Propositions
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      En attente
                    </th>
                    <th scope="col" className={TH}>
                      Auteur
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {run.number}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {TIMESTAMP.format(run.calculatedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{run.horizonDays} j</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{run.lineCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{run.proposalCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={run.pendingCount > 0 ? "text-copper" : "text-muted"}>
                          {run.pendingCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{run.calculatedByName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/achats/besoins/${run.id}`}
                          aria-label={`Ouvrir le calcul ${run.number}`}
                          title="Ouvrir le calcul"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {runs.length === 100 ? (
          <p className="mt-3 text-[10px] text-muted">Affichage des 100 calculs les plus récents.</p>
        ) : null}
      </main>
    </div>
  );
}
