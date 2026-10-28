import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Banknote, Info } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DiscussionPanel } from "@/components/discussion-panel";
import { DocumentTasks } from "@/components/document-tasks";
import { LoadingShell } from "@/components/loading-shell";
import { InvoiceStatusBadge } from "@/components/sales-badges";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { PAYMENT_METHOD_LABELS } from "@/modules/sales/payment-methods";
import { getInvoice } from "@/modules/sales/queries";
import { formatQuantity } from "@/modules/stock/quantities";
import { PaymentForm } from "./payment-form";
import { ValidateInvoiceButton } from "./validate-invoice-button";

export const metadata: Metadata = {
  title: "Facture client",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = "px-4 py-2.5 font-normal";
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (typeof query.cree === "string") {
    return {
      tone: "success",
      text: "Facture créée en brouillon. Validez-la pour obtenir son numéro et créer la créance.",
    };
  }
  if (typeof query.validee === "string") {
    return {
      tone: "success",
      text: `Facture ${query.validee} validée ; les quantités facturées sont désormais figées.`,
    };
  }
  if (typeof query.regle === "string") {
    return {
      tone: "success",
      text: "Règlement enregistré ; le solde de la facture est à jour.",
    };
  }
  return null;
}

export default function InvoicePage(props: PageProps<"/factures/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la facture…" />}>
      <InvoiceContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function InvoiceContent({
  params,
  searchParams,
}: Pick<PageProps<"/factures/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id: invoiceId } = await params;
  if (!UUID_PATTERN.test(invoiceId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships, query] = await Promise.all([
    getInvoice(db, { tenantId: session.tenantId, invoiceId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!detail) {
    notFound();
  }

  const { invoice, lines, payments } = detail;
  const canWrite = can(session.role, "data.write");
  const today = todayIsoDate();
  const overdue =
    invoice.status === "validated" && invoice.balanceXof > 0 && invoice.dueDate < today;
  const banner = bannerFor(query);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="invoices" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/factures"
            aria-label="Revenir aux factures"
            title="Revenir aux factures"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Facture client
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-medium tracking-tight">
                {invoice.number ?? "Brouillon"}
              </h1>
              <InvoiceStatusBadge status={invoice.status} />
              {overdue ? (
                <span className="inline-flex rounded-full border border-copper/20 bg-copper-soft px-2 py-0.5 text-[10px] whitespace-nowrap text-copper">
                  Échue
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {invoice.customerName} · <span className="font-mono">{invoice.customerCode}</span> ·
              commande {invoice.orderNumber ?? "—"}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Link
              href={`/ventes/${invoice.orderId}`}
              aria-label="Ouvrir la commande client"
              title="Ouvrir la commande client"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
            {canWrite && invoice.status === "draft" ? (
              <ValidateInvoiceButton invoiceId={invoice.id} />
            ) : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className={`mt-4 rounded-md border px-3 py-2 text-[11px] leading-5 ${
              banner.tone === "warning"
                ? "border-copper/20 bg-copper-soft text-copper"
                : "border-brand/20 bg-brand-soft text-brand-strong"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Total HT</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{formatXof(invoice.exTaxTotal)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Réglé</dt>
            <dd className="mt-1 font-mono text-lg text-brand-strong tabular-nums">
              {formatXof(invoice.paidXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Solde</dt>
            <dd className={`mt-1 font-mono text-lg tabular-nums ${overdue ? "text-copper" : ""}`}>
              {formatXof(invoice.balanceXof)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Échéance</dt>
            <dd className="mt-1 text-[11px] font-medium tabular-nums">
              {isoDateLabel(invoice.dueDate)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[10px] text-muted">
          Facturée le {isoDateLabel(invoice.invoiceDate)}
          {invoice.validatedAt ? (
            <>
              {" "}
              · validée le{" "}
              <time dateTime={invoice.validatedAt.toISOString()}>
                {dateTimeFormatter.format(invoice.validatedAt)}
              </time>
            </>
          ) : null}
        </p>

        {invoice.notes ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[11px] leading-5 text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
            <p className="whitespace-pre-line">{invoice.notes}</p>
          </div>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Lignes facturées</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Lignes de la facture</caption>
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
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                      {String(line.lineNumber).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">
                        <span className="font-mono text-[10px] text-muted">{line.articleCode}</span>{" "}
                        {line.articleName}
                      </span>
                      <span className="text-[10px] text-muted">{line.unitCode}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(line.qty)}
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

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Banknote className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Règlements</h2>
            <span className="ml-auto font-mono text-[10px] text-muted">{payments.length}</span>
          </div>

          {payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              {invoice.status === "validated"
                ? "Aucun règlement pour l'instant."
                : "Les règlements seront possibles une fois la facture validée."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Règlements de la facture</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Moyen
                    </th>
                    <th scope="col" className={TH}>
                      Référence
                    </th>
                    <th scope="col" className={TH}>
                      Saisi le
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Montant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(payment.paidDate)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </td>
                      <td className="max-w-64 truncate px-4 py-2.5 font-mono text-[10px] text-muted">
                        {payment.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {dateTimeFormatter.format(payment.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(payment.amountXof)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {invoice.status === "draft" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            La validation attribue le numéro FAC, fige les quantités facturées et rend les
            règlements possibles.
          </p>
        ) : invoice.balanceXof === 0 ? (
          <p className="mt-4 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3 text-[11px] text-brand-strong">
            Facture intégralement réglée.
          </p>
        ) : canWrite ? (
          <PaymentForm
            key={`${invoice.id}:${invoice.balanceXof}`}
            invoiceId={invoice.id}
            balanceXof={invoice.balanceXof}
            today={today}
          />
        ) : null}

        <DocumentTasks
          session={session}
          entityType="invoice"
          entityId={invoice.id}
          label={invoice.number ?? "Facture en brouillon"}
        />
        <DiscussionPanel session={session} entityType="invoice" entityId={invoice.id} />
      </main>
    </div>
  );
}
