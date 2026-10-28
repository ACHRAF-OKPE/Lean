import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Landmark, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { CatalogActions } from "@/components/catalog-actions";
import { DeclarationStatusBadge } from "@/components/customs-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { customsCounters, listDeclarations } from "@/modules/customs/queries";

export const metadata: Metadata = {
  title: "Douane",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function CustomsPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des déclarations…" />}>
      <CustomsContent />
    </Suspense>
  );
}

async function CustomsContent() {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [declarations, counters, memberships] = await Promise.all([
    listDeclarations(db, { tenantId: session.tenantId }),
    customsCounters(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Douane</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Déclarations en douane</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Du dépôt à la mainlevée. La liquidation fige le CIF, les droits TEC et les taxes ;
              l&apos;acquit et les paiements conditionnent la sortie.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1.5 rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {declarations.length} déclaration{declarations.length > 1 ? "s" : ""}
            </span>
            <Link
              href="/douane/acquits"
              aria-label="Ouvrir les acquits-à-caution"
              title="Acquits-à-caution"
              className={ACTION_LINK}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/douane/referentiels"
              aria-label="Ouvrir les référentiels douaniers"
              title="Référentiels douaniers"
              className={ACTION_LINK}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Link>
            <CatalogActions kind="customs_lines" />
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Brouillons</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.draft}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Déposées</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">
              {counters.deposited}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Liquidées</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{counters.liquidated}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">En attente de paiement</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">
              {counters.awaitingPayment}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Mainlevées</dt>
            <dd className="mt-1 font-mono text-2xl text-brand tabular-nums">{counters.cleared}</dd>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {declarations.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Landmark className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune déclaration dans cet espace. Créez un brouillon, ajoutez ses lignes puis
                importez-les en XLSX avec le modèle téléchargeable.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Déclarations en douane de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Déclaration
                    </th>
                    <th scope="col" className={TH}>
                      Régime
                    </th>
                    <th scope="col" className={TH}>
                      Bureau
                    </th>
                    <th scope="col" className={TH}>
                      Tiers déclaré
                    </th>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Total dû
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Payé
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Acquit
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.map((declaration) => (
                    <tr key={declaration.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {declaration.number}
                        {declaration.externalReference ? (
                          <span className="block text-[9px] text-muted">
                            {declaration.externalReference}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="block">{declaration.regimeLabel}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {declaration.regimeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted">
                        {declaration.officeCode}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{declaration.partnerName}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {declaration.partnerCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(declaration.declarationDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(declaration.grandTotal)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(declaration.paidTotal)}
                      </td>
                      <td className="px-4 py-2.5">
                        <DeclarationStatusBadge status={declaration.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        {declaration.bondStatus === "open" ? (
                          <span className="font-mono text-[10px] text-copper">Ouvert</span>
                        ) : declaration.bondStatus === "apured" ? (
                          <span className="font-mono text-[10px] text-brand">Apuré</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/douane/${declaration.id}`}
                          aria-label={`Ouvrir la déclaration ${declaration.number}`}
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

        {declarations.length === 200 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 200 déclarations les plus récentes.
          </p>
        ) : null}
      </main>
    </div>
  );
}
