import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, FileSignature, Plus, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TenderStatusBadge } from "@/components/tender-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listTenders } from "@/modules/tenders/queries";

export const metadata: Metadata = {
  title: "Appels d'offres",
};

const TH = "px-4 py-2.5 font-normal";

export default function TendersPage({ searchParams }: PageProps<"/achats/appels-offres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des appels d'offres…" />}>
      <TendersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TendersContent({
  searchParams,
}: Pick<PageProps<"/achats/appels-offres">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const query = await searchParams;
  const db = getDb();
  const [tenders, memberships] = await Promise.all([
    listTenders(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  const today = todayIsoDate();
  const open = tenders.filter((tender) => tender.status === "open").length;
  const awarded = tenders.filter((tender) => tender.status === "awarded").length;
  const drafts = tenders.filter((tender) => tender.status === "draft").length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tenders" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Achats</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Appels d&apos;offres</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Un besoin, plusieurs fournisseurs, un lien de cotation personnel par e-mail. Comparez
              les offres ligne par ligne, attribuez, puis générez les commandes d&apos;un geste.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-muted">
              {tenders.length} demande{tenders.length > 1 ? "s" : ""}
            </span>
            <Link
              href="/achats/appels-offres/nouveau"
              aria-label="Créer une demande de cotation"
              title="Nouvelle demande de cotation"
              className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {typeof query.supprimee === "string" ? (
          <p
            role="status"
            className="mt-5 flex gap-2 rounded-md border border-brand/20 bg-brand-soft px-3 py-2.5 text-[11px] leading-5 text-brand-strong"
          >
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Brouillon supprimé. Aucun fournisseur n&apos;a été contacté.</span>
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Demandes ouvertes</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{open}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Brouillons</dt>
            <dd className="mt-1 font-mono text-2xl text-copper tabular-nums">{drafts}</dd>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <FileSignature className="size-4 text-brand" aria-hidden="true" />
            <p className="text-[10px] leading-4 text-muted">
              {awarded} demande{awarded > 1 ? "s" : ""} attribuée{awarded > 1 ? "s" : ""} : les
              commandes restent des brouillons jusqu&apos;à confirmation.
            </p>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {tenders.length === 0 ? (
            <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
              Aucune demande de cotation dans cet espace. Créez la première : vos fournisseurs
              coteront directement en ligne, sans compte à créer.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Demandes de cotation de l&apos;espace actif</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Demande
                    </th>
                    <th scope="col" className={TH}>
                      Intitulé
                    </th>
                    <th scope="col" className={TH}>
                      Échéance
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Lignes
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Invités
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Cotés
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenders.map((tender) => {
                    const late = tender.status === "open" && tender.deadline < today;
                    return (
                      <tr key={tender.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                          {tender.number ?? <span className="text-muted">Brouillon</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="block max-w-72 truncate font-medium">
                            {tender.title}
                          </span>
                          <span className="block font-mono text-[10px] text-muted">
                            {tender.awardedCount} attribuée{tender.awardedCount > 1 ? "s" : ""}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${
                            late ? "text-copper" : "text-muted"
                          }`}
                        >
                          {isoDateLabel(tender.deadline)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{tender.lineCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {tender.supplierCount}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {tender.quotedCount}
                        </td>
                        <td className="px-4 py-2.5">
                          <TenderStatusBadge status={tender.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/achats/appels-offres/${tender.id}`}
                            aria-label={`Ouvrir la demande ${tender.number ?? tender.title}`}
                            title="Ouvrir la demande"
                            className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {tenders.length === 200 ? (
          <p className="mt-3 text-[10px] text-muted">
            Affichage des 200 demandes les plus récentes.
          </p>
        ) : null}
      </main>
    </div>
  );
}
