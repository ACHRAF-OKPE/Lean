import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Layers } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { APUREMENT_DECLARATION_STATE_LABELS } from "@/modules/customs/apurement";
import { listApurementOverviews } from "@/modules/customs/queries";
import { formatQuantity } from "@/modules/stock/quantities";

export const metadata: Metadata = {
  title: "Apurement progressif",
};

const TH = "px-4 py-2.5 font-normal";

export default function ApurementPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des apurements…" />}>
      <ApurementContent />
    </Suspense>
  );
}

async function ApurementContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [rows, memberships] = await Promise.all([
    listApurementOverviews(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  const openCount = rows.filter((row) => row.progress.state === "open").length;
  const partialCount = rows.filter((row) => row.progress.state === "partial").length;
  const apuredCount = rows.filter((row) => row.progress.state === "apured").length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-center gap-3">
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
            <h1 className="text-2xl font-medium tracking-tight">Apurement progressif</h1>
          </div>
          <span className="ml-auto rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
            {rows.length} sommier{rows.length > 1 ? "s" : ""} IM9
          </span>
          <CatalogActions kind="customs_apurements" />
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Les déclarations admises sous un régime à apurement progressif (IM9, zone franche) gardent
          leurs articles au sommier. Chaque écriture apure une quantité d&apos;une ligne, sans
          jamais dépasser la quantité déclarée ; l&apos;avancement se déduit du journal.
        </p>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Ouverts</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{openCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Partiels</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">{partialCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Apurés</dt>
            <dd className="mt-1 font-mono text-2xl text-brand tabular-nums">{apuredCount}</dd>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Layers className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun sommier IM9 liquidé. Créez un régime marqué « apurement progressif », puis une
                déclaration liquidée : ses lignes deviennent les articles du sommier.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Apurement progressif des déclarations IM9 de l&apos;espace actif
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Déclaration
                    </th>
                    <th scope="col" className={TH}>
                      Régime
                    </th>
                    <th scope="col" className={TH}>
                      Tiers déclaré
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Lignes apurées
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Avancement
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Restant
                    </th>
                    <th scope="col" className={TH}>
                      État
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {row.number}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="block">{row.regimeLabel}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {row.regimeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{row.partnerName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(row.declarationDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {row.progress.apuredLineCount}/{row.progress.lineCount}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {(row.progress.averageRateBp / 100).toFixed(1)} %
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {row.progress.remainingQuantity !== null && row.progress.unitCode
                          ? `${formatQuantity(row.progress.remainingQuantity)} ${row.progress.unitCode}`
                          : "— unités mixtes"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={
                            row.progress.state === "apured"
                              ? "font-mono text-[10px] text-brand"
                              : row.progress.state === "partial"
                                ? "font-mono text-[10px] text-copper"
                                : "font-mono text-[10px] text-muted"
                          }
                        >
                          {APUREMENT_DECLARATION_STATE_LABELS[row.progress.state]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/douane/${row.id}`}
                          aria-label={`Ouvrir la déclaration ${row.number}`}
                          title="Ouvrir la déclaration"
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
      </main>
    </div>
  );
}
