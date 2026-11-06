import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TenderSettingsForm } from "@/components/tender-settings-form";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { DEFAULT_TENDER_DEADLINE_DAYS, getTenderSettingsView } from "@/modules/tenders/settings";

export const metadata: Metadata = {
  title: "Paramètres des appels d'offres",
};

export default function TenderSettingsPage(props: PageProps<"/achats/appels-offres/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <TenderSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TenderSettingsContent({
  searchParams,
}: Pick<PageProps<"/achats/appels-offres/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("tenders", "read");
  const [settings, memberships, query] = await Promise.all([
    getTenderSettingsView(getDb(), session.tenantId),
    listMembershipsForUser(getDb(), session.userId),
    searchParams,
  ]);
  const canManage = await canAccessModule(session, "tenders", "manage");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tenders" />
      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/achats/appels-offres"
            aria-label="Revenir aux appels d'offres"
            title="Revenir aux appels d'offres"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Appels d&apos;offres
            </p>
            <h1 className="text-2xl font-medium tracking-tight">
              Paramètres des appels d&apos;offres
            </h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le délai de réponse enregistré est proposé à la création des demandes. Sans réglage,
          aucune date n&apos;est préremplie. Les demandes déjà créées gardent leur échéance.
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
            <dt className="text-[10px] text-muted">Délai de réponse par défaut</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">
              {settings ? `${settings.defaultDeadlineDays} jours` : "Aucun réglage"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Portée</dt>
            <dd className="mt-1 text-sm">Nouvelles demandes uniquement</dd>
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
            <TenderSettingsForm
              defaultDeadlineDays={settings?.defaultDeadlineDays ?? DEFAULT_TENDER_DEADLINE_DAYS}
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
