import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { InvoiceSettingsForm } from "@/components/invoice-settings-form";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS,
  getInvoiceSettingsView,
} from "@/modules/sales/invoice-settings";

export const metadata: Metadata = {
  title: "Paramètres des factures",
};

export default function InvoiceSettingsPage(props: PageProps<"/factures/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <InvoiceSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function InvoiceSettingsContent({
  searchParams,
}: Pick<PageProps<"/factures/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("invoices", "read");
  const db = getDb();
  const [settings, memberships, query] = await Promise.all([
    getInvoiceSettingsView(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canManage = await canAccessModule(session, "invoices", "manage");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="invoices" />
      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/factures"
            aria-label="Revenir aux factures"
            title="Revenir aux factures"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Factures</p>
            <h1 className="text-2xl font-medium tracking-tight">Paramètres des factures</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le délai est unique par espace et sert à proposer la date d&apos;échéance lors de la
          création d&apos;une facture. Le délai actuel de 30 jours reste appliqué tant qu&apos;aucun
          paramétrage n&apos;est enregistré. Les factures déjà créées gardent leur échéance.
        </p>

        {typeof query.enregistre === "string" ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Paramétrage enregistré.
          </p>
        ) : null}

        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Délai d&apos;échéance par défaut</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {settings?.dueDateOffsetDays ?? DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS} jours
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Portée</dt>
            <dd className="mt-1 text-sm">Nouvelles factures uniquement</dd>
          </div>
        </dl>

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {settings === null ? "Définir le paramétrage" : "Modifier le paramétrage"}
              </h2>
            </div>
            <InvoiceSettingsForm
              dueDateOffsetDays={
                settings?.dueDateOffsetDays ?? DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS
              }
            />
          </section>
        ) : (
          <p className="mt-5 text-[11px] text-muted">
            Seul un rôle disposant du niveau gestion peut modifier ce paramétrage.
          </p>
        )}
      </main>
    </div>
  );
}
