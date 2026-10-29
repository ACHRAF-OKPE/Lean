import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Clock,
  Mail,
  Pencil,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TenderInvitationStatusBadge, TenderStatusBadge } from "@/components/tender-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { offersByLine, type TenderOffer } from "@/modules/tenders/awards";
import { getTender } from "@/modules/tenders/queries";
import { tenderStatusLabel } from "@/modules/tenders/rules";
import { formatQuantity, isZeroQuantity } from "@/modules/stock/quantities";
import {
  DeleteTenderButton,
  CancelTenderForm,
  GenerateOrdersButton,
  SendTenderButton,
} from "./tender-actions";
import { AwardTenderForm, RejectTenderLineButton, ResendInvitationButton } from "./line-actions";

export const metadata: Metadata = {
  title: "Demande de cotation",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = "px-4 py-2.5 font-normal";
const TIMESTAMP = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function bannersFor(query: Record<string, string | string[] | undefined>): Banner[] {
  const banners: Banner[] = [];
  if (single(query.cree)) {
    banners.push({
      tone: "success",
      text: "Brouillon créé. Complétez-le puis envoyez-le pour obtenir le numéro DAO et les liens fournisseurs.",
    });
  }
  if (single(query.maj)) {
    banners.push({ tone: "success", text: "Brouillon mis à jour." });
  }
  const envoye = single(query.envoye);
  if (envoye) {
    banners.push({
      tone: "success",
      text: `Demande ${envoye} envoyée à ${single(query.livres) ?? "0"} fournisseur(s) : chaque lien est personnel.`,
    });
  }
  const echecs = Number.parseInt(single(query.echecs) ?? "", 10);
  if (Number.isFinite(echecs) && echecs > 0) {
    banners.push({
      tone: "warning",
      text: `${echecs} envoi(s) ont échoué : renvoyez le lien depuis la liste des invitations.`,
    });
  }
  const renvoye = single(query.renvoye);
  if (renvoye) {
    banners.push({ tone: "success", text: `Nouveau lien envoyé à ${renvoye}.` });
  }
  if (single(query.attribue)) {
    banners.push({
      tone: "success",
      text: "Ligne attribuée. Les offres restantes sont conservées.",
    });
  }
  if (single(query.ecartee)) {
    banners.push({ tone: "success", text: "Ligne écartée de l'attribution." });
  }
  const commandes = Number.parseInt(single(query.commandes) ?? "", 10);
  if (Number.isFinite(commandes) && commandes > 0) {
    banners.push({
      tone: "success",
      text: `${commandes} commande(s) brouillon créée(s) : confirmez-les depuis les achats pour obtenir le numéro CMD.`,
    });
  }
  if (single(query.annulee)) {
    banners.push({
      tone: "warning",
      text: "Demande annulée : les liens publics sont révoqués.",
    });
  }
  return banners;
}

export default function TenderDetailPage(props: PageProps<"/achats/appels-offres/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la demande de cotation…" />}>
      <TenderDetailContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TenderDetailContent({
  params,
  searchParams,
}: Pick<PageProps<"/achats/appels-offres/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }
  const query = await searchParams;
  const db = getDb();
  const [detail, memberships] = await Promise.all([
    getTender(db, { tenantId: session.tenantId, tenderId: id }),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!detail) {
    notFound();
  }
  const banners = bannersFor(query);
  const canWrite = can(session.role, "data.write");
  const { tender, lines, invitations, awards, purchaseOrders } = detail;

  const offers: TenderOffer[] = invitations.flatMap((invitation) => {
    const quote = invitation.latestQuote;
    if (!quote || quote.declined) {
      return [];
    }
    return quote.lines
      .filter((line) => !isZeroQuantity(line.proposedQty))
      .map((line) => ({
        tenderLineId: line.tenderLineId,
        quoteId: quote.id,
        quoteLineId: line.id,
        supplierId: invitation.supplierId,
        supplierName: invitation.supplierName,
        revision: quote.revision,
        proposedQty: line.proposedQty,
        unitPriceXof: line.unitPriceXof,
        lineTotalXof: line.lineTotalXof,
        leadTimeDays: quote.leadTimeDays,
        submittedAt: quote.submittedAt,
      }));
  });
  const groupedOffers = offersByLine(offers);
  const awardsByLine = new Map(awards.map((award) => [award.tenderLineId, award]));
  const latestQuoteByInvitation = new Map(
    invitations.flatMap((invitation) =>
      invitation.latestQuote ? [[invitation.id, invitation.latestQuote] as const] : [],
    ),
  );
  const lineNumberById = new Map(lines.map((line) => [line.id, line.lineNumber]));
  const unresolved = lines.filter((line) => !line.rejected && !awardsByLine.has(line.id)).length;
  const late = tender.status === "open" && tender.deadline < todayIsoDate();
  const showAwardControls = canWrite && tender.status === "open";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tenders" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link
              href="/achats/appels-offres"
              aria-label="Revenir aux appels d'offres"
              title="Revenir aux appels d'offres"
              className="mt-1 grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                Achats · Appel d&apos;offres
              </p>
              <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-medium tracking-tight">
                {tender.title}
                <TenderStatusBadge status={tender.status} />
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                <span className="font-mono text-[11px] text-ink">
                  {tender.number ?? "Sans numéro (brouillon)"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />
                  Échéance {isoDateLabel(tender.deadline)}
                  {late ? " · dépassée, attribution encore possible" : ""}
                </span>
                <span>{invitations.length} fournisseur(s) invité(s)</span>
                <span>{unresolved} ligne(s) à trancher</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && tender.status === "draft" ? (
              <>
                <Link
                  href={`/achats/appels-offres/${tender.id}/modifier`}
                  aria-label="Modifier le brouillon"
                  title="Modifier le brouillon"
                  className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Link>
                <DeleteTenderButton tenderId={tender.id} />
                <SendTenderButton tenderId={tender.id} />
              </>
            ) : null}
            {canWrite &&
            tender.status === "awarded" &&
            !tender.ordersCreatedAt &&
            awards.length > 0 ? (
              <GenerateOrdersButton tenderId={tender.id} />
            ) : null}
          </div>
        </div>

        {banners.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {banners.map((banner) => (
              <li
                key={banner.text}
                role="status"
                className={`flex gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-5 ${
                  banner.tone === "success"
                    ? "border-brand/20 bg-brand-soft text-brand-strong"
                    : "border-copper/20 bg-copper-soft text-copper"
                }`}
              >
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{banner.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {tender.status === "cancelled" ? (
          <p className="mt-5 flex gap-2 rounded-md border border-copper/20 bg-copper-soft px-3 py-2.5 text-[11px] leading-5 text-copper">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Annulée le {tender.cancelledAt ? TIMESTAMP.format(tender.cancelledAt) : "—"} —{" "}
              {tender.cancelReason ?? "motif non renseigné"}.
            </span>
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Lignes attribuées</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {awards.length} / {lines.length}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Cotés / invités</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {invitations.filter((row) => row.quoteCount > 0).length} / {invitations.length}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Commandes générées</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {tender.ordersCreatedAt ? purchaseOrders.length : 0}
            </dd>
          </div>
        </dl>

        {tender.notes ? (
          <div className="mt-3 rounded-lg border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted">
            <p className="font-medium text-ink">Note aux fournisseurs</p>
            <p className="mt-0.5 whitespace-pre-line">{tender.notes}</p>
          </div>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Besoins</h2>
            <p className="mt-0.5 text-[10px] text-muted">
              Quantités demandées et état d&apos;attribution de chaque ligne.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de besoin de la demande</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Ligne
                  </th>
                  <th scope="col" className={TH}>
                    Article
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Quantité
                  </th>
                  <th scope="col" className={TH}>
                    Date souhaitée
                  </th>
                  <th scope="col" className={TH}>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const award = awardsByLine.get(line.id);
                  return (
                    <tr key={line.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                        {String(line.lineNumber).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{line.name}</span>
                        <span className="block font-mono text-[10px] text-muted">
                          {line.articleCode}
                          {line.note ? ` · ${line.note}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.qty)} {line.unitCode}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {line.requestedDate ? isoDateLabel(line.requestedDate) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {line.rejected ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                            <XCircle className="size-3" aria-hidden="true" />
                            Écartée
                          </span>
                        ) : award ? (
                          <span className="block">
                            <span className="block text-[10px] font-medium">
                              {award.supplierName}
                            </span>
                            <span className="block font-mono text-[10px] text-muted">
                              {formatQuantity(award.qty)} × {formatXof(award.unitPriceXof)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-copper">En attente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Invitations</h2>
            <p className="mt-0.5 text-[10px] text-muted">
              Un lien par fournisseur. Un renvoi remplace le lien précédent.
            </p>
          </div>
          {invitations.length === 0 ? (
            <p className="px-5 py-6 text-center text-[11px] text-muted">
              Aucune invitation sur cette demande.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Fournisseurs invités</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Fournisseur
                    </th>
                    <th scope="col" className={TH}>
                      Destinataire
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    <th scope="col" className={TH}>
                      Envoi
                    </th>
                    <th scope="col" className={TH}>
                      Dernière cotation
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Renvoyer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => {
                    const quote = latestQuoteByInvitation.get(invitation.id);
                    return (
                      <tr key={invitation.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5">
                          <span className="block font-medium">{invitation.supplierName}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {invitation.supplierCode}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="block">{invitation.recipientName ?? "—"}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {invitation.recipientEmail}
                          </span>
                          {invitation.errorMessage ? (
                            <span className="mt-0.5 block text-[10px] text-copper">
                              {invitation.errorMessage}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <TenderInvitationStatusBadge status={invitation.status} />
                          {invitation.firstViewedAt ? (
                            <span className="mt-1 block font-mono text-[10px] text-muted">
                              vu {TIMESTAMP.format(invitation.firstViewedAt)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                          {invitation.sentAt ? TIMESTAMP.format(invitation.sentAt) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {quote ? (
                            quote.declined ? (
                              <span className="text-[10px] text-copper">Refus motivé</span>
                            ) : (
                              <span className="block">
                                <span className="block font-mono text-[10px]">
                                  révision {quote.revision} · {formatXof(quote.totalXof)}
                                </span>
                                <span className="block text-[10px] text-muted">
                                  {quote.leadTimeDays === null
                                    ? "délai non précisé"
                                    : `${quote.leadTimeDays} j`}
                                </span>
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] text-muted">Aucune</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canWrite && tender.status === "open" ? (
                            <div className="flex justify-end">
                              <ResendInvitationButton
                                tenderId={tender.id}
                                invitationId={invitation.id}
                              />
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Comparaison et attribution</h2>
            <p className="mt-0.5 text-[10px] text-muted">
              Le meilleur prix de chaque ligne est en tête. Un motif de 1 à 500 caractères est exigé
              pour retenir une offre plus chère.
            </p>
          </div>

          {lines.map((line) => {
            const lineOffers = groupedOffers.get(line.id) ?? [];
            const award = awardsByLine.get(line.id);
            const best = lineOffers[0] ?? null;
            return (
              <article key={line.id} className="rounded-xl border border-line bg-panel">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <p className="text-[11px]">
                    <span className="font-mono text-[10px] text-muted">
                      {String(line.lineNumber).padStart(2, "0")} ·{" "}
                    </span>
                    <span className="font-medium">{line.name}</span>{" "}
                    <span className="text-muted tabular-nums">
                      — {formatQuantity(line.qty)} {line.unitCode}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    {line.rejected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                        <XCircle className="size-3" aria-hidden="true" />
                        Ligne écartée
                      </span>
                    ) : award ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-brand-strong">
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        Attribuée à {award.supplierName}
                      </span>
                    ) : (
                      <span className="text-[10px] text-copper">
                        {lineOffers.length === 0 ? "Aucune offre" : "À trancher"}
                      </span>
                    )}
                    {showAwardControls && !line.rejected && !award ? (
                      <RejectTenderLineButton tenderId={tender.id} tenderLineId={line.id} />
                    ) : null}
                  </div>
                </div>

                {award ? (
                  <p className="px-4 py-3 text-[11px] leading-5 text-muted">
                    {formatQuantity(award.qty)} × {formatXof(award.unitPriceXof)} — attribuée le{" "}
                    {TIMESTAMP.format(award.awardedAt)}
                    {award.motive ? ` · motif : « ${award.motive} »` : ""}
                  </p>
                ) : line.rejected ? (
                  <p className="px-4 py-3 text-[11px] text-muted">
                    Cette ligne ne fera pas l&apos;objet d&apos;une commande.
                  </p>
                ) : lineOffers.length === 0 ? (
                  <p className="px-4 py-3 text-[11px] text-muted">
                    Aucun fournisseur n&apos;a encore proposé cette ligne. Écartez-la ou attendez
                    une cotation.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <caption className="sr-only">
                        Offres reçues pour la ligne {line.lineNumber}
                      </caption>
                      <thead>
                        <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                          <th scope="col" className={TH}>
                            Fournisseur
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Qté proposée
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Prix unitaire
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Total ligne
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Délai
                          </th>
                          <th scope="col" className={TH}>
                            Attribuer
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineOffers.map((offer) => {
                          const isBest = best?.quoteLineId === offer.quoteLineId;
                          return (
                            <tr
                              key={offer.quoteLineId}
                              className="border-b border-line last:border-b-0"
                            >
                              <td className="px-4 py-2.5">
                                <span className="block font-medium">{offer.supplierName}</span>
                                <span className="block font-mono text-[10px] text-muted">
                                  révision {offer.revision}
                                  {isBest ? " · meilleur prix" : ""}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {formatQuantity(offer.proposedQty)}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {formatXof(offer.unitPriceXof)}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {formatXof(offer.lineTotalXof)}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted tabular-nums">
                                {offer.leadTimeDays === null ? "—" : `${offer.leadTimeDays} j`}
                              </td>
                              <td className="px-4 py-2.5">
                                {showAwardControls ? (
                                  <AwardTenderForm
                                    tenderId={tender.id}
                                    quoteLineId={offer.quoteLineId}
                                    isBest={isBest}
                                  />
                                ) : (
                                  <span className="text-[10px] text-muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {invitations.some((invitation) => invitation.latestQuote) ? (
          <section className="mt-5 space-y-2">
            <h2 className="text-sm font-semibold">Détail des cotations reçues</h2>
            {invitations.map((invitation) => {
              const quote = latestQuoteByInvitation.get(invitation.id);
              if (!quote) {
                return null;
              }
              return (
                <details
                  key={invitation.id}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <summary className="cursor-pointer text-[11px] font-medium">
                    {invitation.supplierName} · révision {quote.revision}
                    {quote.declined ? " · refus" : ` · ${formatXof(quote.totalXof)}`}
                  </summary>
                  <div className="mt-3 space-y-2 text-[11px]">
                    <p className="text-muted">
                      {quote.authorName}
                      {quote.authorEmail ? ` · ${quote.authorEmail}` : ""}
                      {quote.leadTimeDays === null ? "" : ` · délai ${quote.leadTimeDays} j`} ·{" "}
                      {TIMESTAMP.format(quote.submittedAt)}
                    </p>
                    {quote.comment ? (
                      <p className="rounded-md border border-line bg-canvas px-3 py-2 whitespace-pre-line text-muted">
                        {quote.comment}
                      </p>
                    ) : null}
                    {quote.declined ? null : (
                      <table className="w-full text-left">
                        <caption className="sr-only">
                          Lignes de la cotation {invitation.supplierName}
                        </caption>
                        <thead>
                          <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                            <th scope="col" className={TH}>
                              Ligne
                            </th>
                            <th scope="col" className={`${TH} text-right`}>
                              Qté proposée
                            </th>
                            <th scope="col" className={`${TH} text-right`}>
                              Prix unitaire
                            </th>
                            <th scope="col" className={`${TH} text-right`}>
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {quote.lines.map((line) => (
                            <tr key={line.id} className="border-b border-line last:border-b-0">
                              <td className="px-4 py-2 font-mono text-[10px] text-muted tabular-nums">
                                {String(lineNumberById.get(line.tenderLineId) ?? "—").padStart(
                                  2,
                                  "0",
                                )}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">
                                {formatQuantity(line.proposedQty)}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">
                                {line.unitPriceXof === 0 ? "—" : formatXof(line.unitPriceXof)}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">
                                {line.lineTotalXof === 0 ? "—" : formatXof(line.lineTotalXof)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>
              );
            })}
          </section>
        ) : null}

        {purchaseOrders.length > 0 ? (
          <section className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-sm font-semibold">Commandes issues de la demande</h2>
            <ul className="mt-2 space-y-1.5">
              {purchaseOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/achats/${order.id}`}
                    className="inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline"
                  >
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    {order.supplierName}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted">
              Brouillons : confirmez chaque commande pour obtenir son numéro CMD.
            </p>
          </section>
        ) : null}

        {tender.status === "awarded" ? (
          <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted">
            <Mail className="size-3" aria-hidden="true" />
            Demande {tender.number ?? "sans numéro"} attribuée
            {tender.awardedAt ? ` le ${TIMESTAMP.format(tender.awardedAt)}` : ""} —{" "}
            {tenderStatusLabel(tender.status).toLowerCase()}.
          </p>
        ) : null}

        {canWrite && tender.status === "open" ? (
          <div className="mt-5">
            <CancelTenderForm tenderId={tender.id} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
