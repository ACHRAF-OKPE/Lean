import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Handshake } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LetteringTable, UnletterButton } from "@/components/accounting-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getLetteringCandidates, getLetteringGroups } from "@/modules/accounting/lettering";

export const metadata: Metadata = {
  title: "Lettrage",
};

const TH = "px-4 py-2.5 font-normal";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function LetteringPage(props: PageProps<"/comptabilite/lettrage">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du lettrage…" />}>
      <LetteringContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LetteringContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/lettrage">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [candidates, groups, memberships, query] = await Promise.all([
    getLetteringCandidates(db, session.tenantId),
    getLetteringGroups(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const lettered = typeof query.lettre === "string";
  const unlettered = typeof query.delettre === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Lettrage des comptes de tiers</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Sélectionnez au moins deux lignes du même compte de tiers, du même tiers, dont la somme
          des débits égale celle des crédits. Le groupe reçoit un code séquentiel ; le délettrage
          libère toutes ses lignes d&apos;un seul geste.
        </p>

        {lettered ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Lettrage enregistré.
          </p>
        ) : null}
        {unlettered ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Groupe délettré : ses lignes redeviennent disponibles.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Handshake className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Lignes à lettrer</h2>
            <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
              {candidates.length}
            </span>
          </div>
          {candidates.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Handshake className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucune ligne de tiers non lettrée. Les factures et règlements comptabilisés
                apparaîtront ici dès leur validation.
              </p>
            </div>
          ) : canWrite ? (
            <LetteringTable candidates={candidates} />
          ) : (
            <p className="px-5 py-6 text-[11px] text-muted">
              Seul un rôle disposant du droit d&apos;écriture peut lettrer.
            </p>
          )}
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Groupes lettrés</h2>
          </div>
          {groups.length === 0 ? (
            <p className="px-5 py-6 text-[11px] text-muted">
              Aucun groupe lettré pour l&apos;instant.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Groupes de lettrage de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Code
                    </th>
                    <th scope="col" className={TH}>
                      Compte
                    </th>
                    <th scope="col" className={TH}>
                      Tiers
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Lignes
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Débit
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Crédit
                    </th>
                    <th scope="col" className={TH}>
                      Lettré le
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Délettrer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.code} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{group.code}</td>
                      <td className="px-4 py-2.5 font-mono text-[10px]">{group.accountCode}</td>
                      <td className="px-4 py-2.5">{group.partnerName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{group.lineCount}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(group.totalDebit)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(group.totalCredit)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {dateFormatter.format(group.letteredAt)}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <UnletterButton code={group.code} />
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
