import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { CheckCircle2, CircleAlert, Mail, RefreshCw } from "lucide-react";
import { getDb } from "@/db/client";
import { isoDateLabel } from "@/lib/dates";
import {
  markTenderInvitationViewed,
  getPublicTender,
  type PublicTenderContext,
} from "@/modules/tenders/quote-queries";
import {
  MAX_QUOTE_COMMENT,
  MAX_QUOTE_LEAD_TIME_DAYS,
  MAX_QUOTE_REVISIONS,
} from "@/modules/tenders/quotes";
import { formatQuantity } from "@/modules/stock/quantities";
import { TenderQuoteForm, type QuoteLineInitial } from "./quote-form";

export const metadata: Metadata = {
  title: "Déposer une cotation",
  robots: { index: false, follow: false },
};

const TH = "px-4 py-2.5 font-normal";
const TIMESTAMP = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

export default function TenderQuotePage(props: PageProps<"/cotations/[token]">) {
  return (
    <Suspense fallback={<QuoteFallback />}>
      <TenderQuoteContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

function QuoteFallback() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10 md:py-14">
      <div className="h-6 w-48 animate-pulse rounded bg-line" />
      <div className="mt-6 h-64 animate-pulse rounded-xl border border-line bg-panel" />
    </main>
  );
}

function InactiveLink() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 md:py-24">
      <div className="rounded-xl border border-line bg-panel px-6 py-10 text-center">
        <CircleAlert className="mx-auto size-6 text-copper" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-medium">Lien de cotation inactif</h1>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Ce lien est inconnu, a expiré ou la demande n&apos;accepte plus de cotation. Demandez un
          nouveau lien à votre interlocuteur : il vous en transmettra un par e-mail.
        </p>
      </div>
    </main>
  );
}

async function TenderQuoteContent({
  params,
  searchParams,
}: Pick<PageProps<"/cotations/[token]">, "params" | "searchParams">) {
  await connection();
  const { token } = await params;
  const query = await searchParams;
  const db = getDb();
  const context = await getPublicTender(db, token);
  if (!context) {
    return <InactiveLink />;
  }
  await markTenderInvitationViewed(db, context);
  const submitted = typeof query.deposee === "string";
  return <QuoteView token={token} context={context} submitted={submitted} />;
}

function QuoteView({
  token,
  context,
  submitted,
}: {
  token: string;
  context: PublicTenderContext;
  submitted: boolean;
}) {
  const latest = context.latestQuote;
  const limitReached = context.revisionCount >= MAX_QUOTE_REVISIONS;
  const lineNumberById = new Map(context.lines.map((line) => [line.id, line.lineNumber]));
  const initial: Record<number, QuoteLineInitial> = {};
  if (latest) {
    for (const line of latest.lines) {
      const lineNumber = lineNumberById.get(line.tenderLineId);
      if (lineNumber === undefined) {
        continue;
      }
      initial[lineNumber] = {
        qty: line.proposedQty,
        price: line.unitPriceXof > 0 ? String(line.unitPriceXof) : "",
      };
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-6 py-4">
          <span className="grid size-8 place-items-center rounded-md bg-brand text-[12px] font-semibold text-white">
            L
          </span>
          <div>
            <p className="text-[11px] font-medium">{context.companyName}</p>
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
              Demande de cotation · Lean
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 md:py-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
          <Mail className="size-3" aria-hidden="true" />
          Lien personnel de {context.supplierName}
        </p>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">
          Coter la demande <span className="font-mono text-xl">{context.number}</span>
        </h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
          {context.title} — proposé par {context.companyName}. Indiquez les quantités que vous
          pouvez fournir, vos prix unitaires en XOF et votre délai. Aucune inscription n&apos;est
          requise.
        </p>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Date limite</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">{context.deadlineLabel}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Lignes demandées</dt>
            <dd className="mt-1 font-mono text-base tabular-nums">{context.lines.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Révisions déposées</dt>
            <dd className="mt-1 font-mono text-base tabular-nums">
              {context.revisionCount} / {MAX_QUOTE_REVISIONS}
            </dd>
          </div>
        </dl>

        {submitted ? (
          <p
            role="status"
            className="mt-4 flex gap-2 rounded-md border border-brand/20 bg-brand-soft px-3 py-2.5 text-[11px] leading-5 text-brand-strong"
          >
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Cotation déposée. {context.companyName} la recevra immédiatement ; vous pouvez encore la
            corriger jusqu&apos;à la date limite.
          </p>
        ) : latest ? (
          <p className="mt-4 flex gap-2 rounded-md border border-line bg-panel px-3 py-2.5 text-[11px] leading-5 text-muted">
            <RefreshCw className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Révision {latest.revision} reçue le {TIMESTAMP.format(latest.submittedAt)}
            {latest.declined ? " (refus motivé)" : ""}. Déposer à nouveau crée une révision qui
            remplace la précédente.
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Lignes demandées</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de la demande de cotation</caption>
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
                </tr>
              </thead>
              <tbody>
                {context.lines.map((line) => (
                  <tr key={line.lineNumber} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                      {String(line.lineNumber).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">{line.name}</span>
                      {line.note ? (
                        <span className="block text-[10px] text-muted">{line.note}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(line.qty)} {line.unitCode}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                      {line.requestedDate ? isoDateLabel(line.requestedDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {limitReached ? (
          <p
            role="status"
            className="mt-6 rounded-md border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted"
          >
            Vous avez atteint le nombre maximal de révisions ({MAX_QUOTE_REVISIONS}). Contactez{" "}
            {context.companyName} pour poursuivre l&apos;échange.
          </p>
        ) : (
          <TenderQuoteForm
            token={token}
            lines={context.lines.map((line) => ({
              lineNumber: line.lineNumber,
              name: line.name,
              unitCode: line.unitCode,
              qty: line.qty,
            }))}
            defaultAuthorName={latest?.authorName ?? context.recipientName ?? ""}
            defaultEmail={latest?.authorEmail ?? ""}
            maxLeadTimeDays={MAX_QUOTE_LEAD_TIME_DAYS}
            maxComment={MAX_QUOTE_COMMENT}
            initial={initial}
            initialLeadTimeDays={
              latest?.leadTimeDays === null || latest?.leadTimeDays === undefined
                ? ""
                : String(latest.leadTimeDays)
            }
            initialComment={latest?.comment ?? ""}
            initialDeclined={latest?.declined ?? false}
          />
        )}

        <p className="mt-6 text-[10px] leading-4 text-muted">
          Lien personnel : ne le transférez pas. Chaque dépôt est horodaté et conservé par{" "}
          {context.companyName}. Date limite : {isoDateLabel(context.deadline)}.
        </p>
      </main>
    </div>
  );
}
