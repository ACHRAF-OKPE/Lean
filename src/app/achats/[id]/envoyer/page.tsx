import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { resolveAppUrl } from "@/lib/app-url";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getExchangeSendContext } from "@/modules/exchange/queries";
import { SendForm } from "./send-form";

export const metadata: Metadata = {
  title: "Envoyer au fournisseur",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SendPurchaseExchangePage(props: PageProps<"/achats/[id]/envoyer">) {
  return (
    <Suspense fallback={<LoadingShell label="Préparation de l'envoi…" />}>
      <SendPurchaseExchangeContent params={props.params} />
    </Suspense>
  );
}

async function SendPurchaseExchangeContent({
  params,
}: Pick<PageProps<"/achats/[id]/envoyer">, "params">) {
  await connection();
  const session = await requirePermission("data.write");
  const { id: orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) {
    notFound();
  }

  const db = getDb();
  const appUrl = await resolveAppUrl();
  const [context, memberships] = await Promise.all([
    getExchangeSendContext(db, {
      tenantId: session.tenantId,
      orderId,
      senderName: session.userName,
      appUrl,
    }),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="purchases" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href={`/achats/${orderId}`}
            aria-label="Revenir à la commande"
            title="Revenir à la commande"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Échange fournisseur
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Envoyer au fournisseur</h1>
            <p className="mt-1 text-[11px] text-muted">
              {context.ready ? (
                <>
                  {context.typeLabel} · {context.order.number ?? "Brouillon"} ·{" "}
                  {context.order.supplierName} · {isoDateLabel(context.order.orderDate)} ·{" "}
                  <span className="tabular-nums">{formatXof(context.order.exTaxTotal)}</span>
                </>
              ) : (
                "Envoi indisponible pour cette commande."
              )}
            </p>
          </div>
          {can(session.role, "settings.manage") ? (
            <Link
              href="/parametres/echanges"
              aria-label="Configurer les échanges"
              title="Configurer les échanges"
              className="ml-auto grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {!context.ready ? (
          <div className="mt-6 flex gap-2 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Envoi impossible</p>
              <p className="mt-0.5">{context.reason}</p>
            </div>
          </div>
        ) : !context.accountReady ? (
          <div className="mt-6 space-y-3 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            <p className="font-medium">Aucun compte d&apos;envoi actif</p>
            <p>
              Configurez et activez le compte SMTP dans les paramètres des échanges avant de
              transmettre le document.
            </p>
            <Link
              href="/parametres/echanges"
              className="inline-flex items-center gap-1.5 font-medium text-copper underline underline-offset-2"
            >
              Ouvrir les paramètres des échanges
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            <SendForm
              orderId={context.order.id}
              type={context.type}
              typeLabel={context.typeLabel}
              recipients={context.recipients}
              templates={context.templates}
              values={context.values}
              lines={context.lines}
              attachmentName={context.attachmentName}
              backHref={`/achats/${context.order.id}`}
            />
          </div>
        )}
      </main>
    </div>
  );
}
