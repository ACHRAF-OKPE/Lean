import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { PayrollSettingsForm } from "@/components/payroll-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getPayrollSettingsView } from "@/modules/payroll/settings";

export const metadata: Metadata = {
  title: "Paramètres de la paie",
};

export default function PayrollSettingsPage(props: PageProps<"/paie/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <PayrollSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PayrollSettingsContent({
  searchParams,
}: Pick<PageProps<"/paie/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("payroll", "read");
  const query = await searchParams;
  const db = getDb();
  const [settings, memberships, levels] = await Promise.all([
    getPayrollSettingsView(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canManage = atLeast(levels.payroll, "manage");
  const saved = query.enregistre !== undefined;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="payroll" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/paie"
            aria-label="Revenir à la paie"
            title="Revenir à la paie"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Paie</p>
            <h1 className="text-2xl font-medium tracking-tight">Paramètres de la paie</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le paramétrage est unique par espace. Le jour de paiement fixe la date de mise en paiement
          ; les taux salarial et patronal servent de référence aux cotisations sociales. Sans
          paramétrage, le jour par défaut est le 28 et les taux valent zéro.
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
            Aucun paramétrage : les valeurs par défaut s&apos;appliquent. Enregistrez pour fixer le
            jour de paiement et les taux de cotisation.
          </p>
        ) : (
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Jour de paiement</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">{settings.paymentDayOfMonth}</dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Taux salarial</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">
                {settings.socialEmployeeRate} %
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Taux patronal</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">
                {settings.socialEmployerRate} %
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
              Le paramétrage ne touche aucun bulletin passé : il s&apos;applique aux bulletins à
              venir.
            </p>
            <PayrollSettingsForm
              values={
                settings
                  ? {
                      paymentDayOfMonth: settings.paymentDayOfMonth,
                      socialEmployeeRate: settings.socialEmployeeRate,
                      socialEmployerRate: settings.socialEmployerRate,
                    }
                  : null
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
