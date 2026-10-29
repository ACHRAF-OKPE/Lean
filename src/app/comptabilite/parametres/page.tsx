import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AccountingSettingsForm } from "@/components/accounting-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listAccounts, listJournals } from "@/modules/accounting/queries";
import { getAccountingSettingsView } from "@/modules/accounting/settings";

export const metadata: Metadata = {
  title: "Paramètres comptables",
};

export default function AccountingSettingsPage(props: PageProps<"/comptabilite/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <AccountingSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AccountingSettingsContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/parametres">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [settings, journals, accounts, memberships, query] = await Promise.all([
    getAccountingSettingsView(db, session.tenantId),
    listJournals(db, { tenantId: session.tenantId }),
    listAccounts(db, { tenantId: session.tenantId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const canWrite = can(session.role, "data.write");
  const saved = typeof query.enregistre === "string";

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Paramètres comptables</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Dès que ce paramétrage existe, chaque facture validée, chaque règlement client et chaque
          réception d&apos;achat est comptabilisé automatiquement dans les journaux choisis. Sans
          paramétrage, aucun document n&apos;est comptabilisé : le rapprochement les signale pour un
          rattrapage manuel.
        </p>

        {saved ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Paramétrage enregistré. Les prochains documents validés seront comptabilisés
            automatiquement.
          </p>
        ) : null}

        {settings === null ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Aucun paramétrage : la comptabilisation automatique est désactivée. Choisissez les
            journaux et les comptes ci-dessous pour l&apos;activer.
          </p>
        ) : (
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Journaux</dt>
              <dd className="mt-1 font-mono text-sm">
                {settings.salesJournalCode} · {settings.purchaseJournalCode} ·{" "}
                {settings.bankJournalCode}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Comptes de tiers</dt>
              <dd className="mt-1 font-mono text-sm">
                {settings.customerAccountCode} · {settings.supplierAccountCode}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Comptes de gestion</dt>
              <dd className="mt-1 font-mono text-sm">
                {settings.salesAccountCode} · {settings.purchaseAccountCode}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Compte de trésorerie</dt>
              <dd className="mt-1 font-mono text-sm">{settings.bankAccountCode}</dd>
            </div>
          </dl>
        )}

        {canWrite ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {settings === null ? "Activer la comptabilisation" : "Modifier le paramétrage"}
              </h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Les écritures déjà comptabilisées ne sont jamais réécrites : un changement ne
              s&apos;applique qu&apos;aux documents validés ensuite.
            </p>
            <AccountingSettingsForm journals={journals} accounts={accounts} values={settings} />
          </section>
        ) : (
          <p className="mt-5 text-[11px] text-muted">
            Seul un rôle disposant du droit d&apos;écriture peut modifier ce paramétrage.
          </p>
        )}
      </main>
    </div>
  );
}
