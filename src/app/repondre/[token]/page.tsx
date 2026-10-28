import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { CircleAlert, Mail } from "lucide-react";
import { getDb } from "@/db/client";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import {
  getSupplierReplyContext,
  type SupplierReplyContext,
} from "@/modules/exchange/reply-queries";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_REPLIES_PER_LINK,
  isReplyTokenShape,
} from "@/modules/exchange/replies";
import { formatQuantity } from "@/modules/stock/quantities";
import { SupplierReplyForm } from "./reply-form";

export const metadata: Metadata = {
  title: "Répondre à une commande",
  robots: { index: false, follow: false },
};

const TH = "px-4 py-2.5 font-normal";

export default function SupplierReplyPage(props: PageProps<"/repondre/[token]">) {
  return (
    <Suspense fallback={<ReplyFallback />}>
      <SupplierReplyContent params={props.params} />
    </Suspense>
  );
}

function ReplyFallback() {
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
        <h1 className="mt-3 text-lg font-medium">Lien de réponse inactif</h1>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Ce lien est inconnu, a expiré ou n&apos;est plus actif. Demandez un nouveau lien à votre
          interlocuteur : il vous en transmettra un par e-mail.
        </p>
      </div>
    </main>
  );
}

async function SupplierReplyContent({ params }: Pick<PageProps<"/repondre/[token]">, "params">) {
  await connection();
  const { token } = await params;
  const context = isReplyTokenShape(token) ? await getSupplierReplyContext(getDb(), token) : null;
  if (!context) {
    return <InactiveLink />;
  }
  return <ReplyView token={token} context={context} />;
}

function ReplyView({ token, context }: { token: string; context: SupplierReplyContext }) {
  const limitReached = context.replyCount >= MAX_REPLIES_PER_LINK;

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
              Réponse fournisseur · Lean
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 md:py-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
          <Mail className="size-3" aria-hidden="true" />
          Message adressé à {context.recipientName ?? context.recipient}
        </p>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">
          Répondre à la commande{" "}
          <span className="font-mono text-xl">{context.orderNumber ?? "sans numéro"}</span>
        </h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
          {context.companyName} vous invite à indiquer la disponibilité, le délai et, si besoin, un
          prix ou une pièce jointe. Aucune inscription n&apos;est requise.
        </p>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Date de la commande</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">
              {isoDateLabel(context.orderDate)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Réception souhaitée</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">
              {context.expectedReceiptDate ? isoDateLabel(context.expectedReceiptDate) : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Référence fournisseur</dt>
            <dd className="mt-1 truncate font-mono text-[11px]">
              {context.externalReference ?? "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Total HT</dt>
            <dd className="mt-1 font-mono text-base tabular-nums">{formatXof(context.totalXof)}</dd>
          </div>
        </dl>

        {context.notes ? (
          <div className="mt-3 rounded-lg border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted">
            <p className="font-medium text-ink">Note de l&apos;acheteur</p>
            <p className="mt-0.5 whitespace-pre-line">{context.notes}</p>
          </div>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Lignes commandées</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de la commande fournisseur</caption>
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
                  <th scope="col" className={`${TH} text-right`}>
                    Prix unitaire
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {context.lines.map((line) => (
                  <tr key={line.lineNumber} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                      {String(line.lineNumber).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{line.name}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(line.qty)} {line.unitCode}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatXof(line.unitPriceXof)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatXof(line.lineTotalXof)}
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
            Ce lien a déjà reçu le nombre maximal de réponses. Contactez votre interlocuteur pour
            poursuivre l&apos;échange.
          </p>
        ) : (
          <SupplierReplyForm
            token={token}
            defaultName={context.recipientName ?? ""}
            defaultEmail={context.recipient}
            maxComment={2000}
            maxAttachmentBytes={MAX_ATTACHMENT_BYTES}
          />
        )}

        <p className="mt-6 text-[10px] leading-4 text-muted">
          Lien personnel : ne le transférez pas. Chaque réponse est horodatée et conservée par{" "}
          {context.companyName}.
        </p>
      </main>
    </div>
  );
}
