import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { PurchaseSettingsForm } from "@/components/purchases-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel, isoDatePlusDays, todayIsoDate } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getPurchaseSettingsView } from "@/modules/purchases/settings";

export const metadata: Metadata = {
  title: "Paramètres des achats",
};

export default function PurchaseSettingsPage(props: PageProps<"/achats/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <PurchaseSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PurchaseSettingsContent({
  searchParams,
}: Pick<PageProps<"/achats/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("purchases", "read");
  const query = await searchParams;
  const db = getDb();
  const [settings, memberships, levels] = await Promise.all([
    getPurchaseSettingsView(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canManage = atLeast(levels.purchases, "manage");
  const saved = query.enregistre !== undefined;
  const delayDays = settings?.defaultReceiptDelayDays ?? 0;
  const proposedDate = isoDatePlusDays(todayIsoDate(), delayDays);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="purchases" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/achats"
            aria-label="Revenir aux achats"
            title="Revenir aux achats"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Achats</p>
            <h1 className="text-2xl font-medium tracking-tight">Paramètres des achats</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le paramétrage est unique par espace. Le délai de réception par défaut est proposé comme
          date de réception prévue à la saisie d&apos;une commande. Sans paramétrage, aucun délai
          n&apos;est proposé.
        </p>

        {saved ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Paramétrage enregistré.
          </p>
        ) : null}

        {settings === null ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Aucun paramétrage : les valeurs par défaut s&apos;appliquent. Enregistrez pour proposer
            une date de réception par défaut.
          </p>
        ) : (
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Délai de réception par défaut</dt>
              <dd className="mt-1 font-mono text-sm">
                {delayDays === 0 ? "Aucun" : `${delayDays} jour${delayDays > 1 ? "s" : ""}`}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Réception proposée aujourd&apos;hui</dt>
              <dd className="mt-1 font-mono text-sm">
                {delayDays === 0 ? "Aucune" : isoDateLabel(proposedDate)}
              </dd>
            </div>
          </dl>
        )}

        {settings ? (
          <p className="mt-2 text-[10px] text-muted">
            Dernière mise à jour le {isoDateLabel(settings.updatedAt.toISOString().slice(0, 10))}.
          </p>
        ) : null}

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {settings === null ? "Définir le paramétrage" : "Modifier le paramétrage"}
              </h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Le délai est un entier de jours entre 0 et 365 ; zéro ne propose aucune date.
            </p>
            <PurchaseSettingsForm
              values={settings ? { defaultReceiptDelayDays: delayDays } : null}
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
