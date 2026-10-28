import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BondStatusBadge } from "@/components/customs-badges";
import { ApurementForm } from "@/components/customs-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listBonds } from "@/modules/customs/queries";

export const metadata: Metadata = {
  title: "Acquits-à-caution",
};

const TH = "px-4 py-2.5 font-normal";

export default function BondsPage(props: PageProps<"/douane/acquits">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des acquits…" />}>
      <BondsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function BondsContent({ searchParams }: Pick<PageProps<"/douane/acquits">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [bonds, memberships, query] = await Promise.all([
    listBonds(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const updated = typeof query.maj === "string";
  const openCount = bonds.filter((bond) => bond.status === "open").length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Acquits-à-caution</h1>
          </div>
          <span className="ml-auto rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
            {openCount} ouvert{openCount > 1 ? "s" : ""} · {bonds.length} au total
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Un acquit couvre une déclaration liquidée dont le régime l&apos;exige. Il s&apos;apure une
          seule fois, avec une référence unique, avant la mainlevée.
        </p>

        {updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Acquit mis à jour.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {bonds.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ShieldCheck className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] text-muted">
                Aucun acquit. Ouvrez-en un depuis une déclaration liquidée dont le régime
                l&apos;exige.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Acquits-à-caution de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Acquit
                    </th>
                    <th scope="col" className={TH}>
                      Déclaration
                    </th>
                    <th scope="col" className={TH}>
                      Tiers déclaré
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Garantie
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      En jeu
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Apurement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bonds.map((bond) => (
                    <tr key={bond.id} className="border-b border-line align-top last:border-b-0">
                      <td className="px-4 py-3 font-mono text-[10px] whitespace-nowrap">
                        {bond.number}
                        <span className="mt-0.5 block text-[9px] text-muted">
                          {bond.guaranteeReference}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/douane/${bond.declarationId}`}
                          className="font-mono text-[10px] hover:text-brand hover:underline"
                        >
                          {bond.declarationNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{bond.partnerName}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatXof(bond.guaranteeAmount)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatXof(bond.amountAtRisk)}
                      </td>
                      <td className="px-4 py-3">
                        <BondStatusBadge status={bond.status} />
                      </td>
                      <td className="min-w-64 px-4 py-3">
                        {bond.status === "apured" ? (
                          <div className="text-[10px] text-muted">
                            <p className="font-mono">{bond.apurementReference}</p>
                            {bond.apuredAt ? (
                              <p className="mt-0.5">
                                le {isoDateLabel(bond.apuredAt.toISOString().slice(0, 10))}
                              </p>
                            ) : null}
                          </div>
                        ) : canWrite ? (
                          <ApurementForm bondId={bond.id} />
                        ) : (
                          <span className="text-[10px] text-muted">Lecture seule</span>
                        )}
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
