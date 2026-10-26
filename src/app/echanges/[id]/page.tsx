import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert, CornerUpLeft, FileText, ShoppingCart } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ExchangeStatusBadge, ExchangeTypeBadge } from "@/components/exchange-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getExchangeMessage } from "@/modules/exchange/queries";
import { ResendButton } from "./resend-button";

export const metadata: Metadata = {
  title: "Message fournisseur",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function bannerFor(
  query: Record<string, string | string[] | undefined>,
  failed: boolean,
): Banner | null {
  if (typeof query.envoye === "string" && !failed) {
    return {
      tone: "success",
      text: "Message remis au serveur SMTP et journalisé. Le bon de commande PDF est joint.",
    };
  }
  if (typeof query.renvoye === "string" && !failed) {
    return {
      tone: "success",
      text: "Renvoi effectué : une nouvelle tentative est journalisée, reliée à la précédente.",
    };
  }
  return null;
}

export default function ExchangeMessagePage(props: PageProps<"/echanges/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du message…" />}>
      <ExchangeMessageContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ExchangeMessageContent({
  params,
  searchParams,
}: Pick<PageProps<"/echanges/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [message, memberships, query] = await Promise.all([
    getExchangeMessage(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!message) {
    notFound();
  }

  const failed = message.status === "failed";
  const banner = bannerFor(query, failed);
  const canWrite = can(session.role, "data.write");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="exchanges" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/echanges"
            aria-label="Revenir au journal des échanges"
            title="Revenir au journal des échanges"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Message fournisseur
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-medium tracking-tight break-words">{message.subject}</h1>
              <ExchangeStatusBadge status={message.status} />
              <ExchangeTypeBadge type={message.type} />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {DATE_TIME.format(message.createdAt)} · {message.actorName ?? "Acteur inconnu"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href={`/achats/${message.orderId}`}
              aria-label="Ouvrir la commande"
              title="Ouvrir la commande"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ShoppingCart className="size-4" aria-hidden="true" />
            </Link>
            {canWrite ? <ResendButton messageId={message.id} /> : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className={`mt-4 rounded-md border px-3 py-2 text-[11px] leading-5 ${
              banner.tone === "success"
                ? "border-brand/20 bg-brand-soft text-brand-strong"
                : "border-copper/20 bg-copper-soft text-copper"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        {failed && message.errorMessage ? (
          <div
            role="alert"
            className="mt-4 flex gap-2 rounded-md border border-copper/20 bg-copper-soft px-3 py-2.5 text-[11px] leading-5 text-copper"
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Envoi refusé par le serveur</p>
              <p className="mt-0.5 break-words">{message.errorMessage}</p>
            </div>
          </div>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Commande</dt>
            <dd className="mt-1 font-mono text-[11px]">{message.orderNumber ?? "Brouillon"}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Fournisseur</dt>
            <dd className="mt-1 truncate text-[11px] font-medium">{message.supplierName}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Destinataire</dt>
            <dd className="mt-1 truncate text-[11px]">{message.recipientName ?? "—"}</dd>
            <dd className="truncate font-mono text-[10px] text-muted">{message.recipient}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Pièce jointe</dt>
            <dd className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px]">
              <FileText className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
              {message.attachmentName}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-muted">
          <span>
            Modèle : <span className="text-ink">{message.templateName}</span>
          </span>
          <span>
            Remis le :{" "}
            <span className="text-ink tabular-nums">
              {message.sentAt ? DATE_TIME.format(message.sentAt) : "—"}
            </span>
          </span>
          <span>
            Identifiant SMTP :{" "}
            <span className="font-mono text-ink">{message.providerMessageId ?? "—"}</span>
          </span>
          {message.resentFromId ? (
            <Link
              href={`/echanges/${message.resentFromId}`}
              className="inline-flex items-center gap-1 text-brand hover:underline"
            >
              <CornerUpLeft className="size-3" aria-hidden="true" />
              Renvoi d&apos;un message antérieur
            </Link>
          ) : null}
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Corps envoyé</h2>
            <p className="mt-0.5 text-[10px] text-muted">
              Instantané journalisé : les modifications ultérieures de la fiche ou du modèle ne le
              changent pas.
            </p>
          </div>
          <div
            className="bg-white px-5 py-4 text-[12px] leading-5 text-black"
            dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
          />
          <details className="border-t border-line px-5 py-3">
            <summary className="cursor-pointer text-[11px] font-medium text-muted">
              Version texte
            </summary>
            <pre className="mt-2 overflow-x-auto text-[11px] leading-5 whitespace-pre-wrap text-ink">
              {message.bodyText}
            </pre>
          </details>
        </section>
      </main>
    </div>
  );
}
