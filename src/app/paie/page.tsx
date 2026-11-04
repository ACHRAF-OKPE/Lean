import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Banknote, ListChecks, Settings2, UserCog } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getPayrollOverview } from "@/modules/payroll/queries";
import { loadPayrollSettings } from "@/modules/payroll/settings";

export const metadata: Metadata = {
  title: "Paie",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function PayrollPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la paie…" />}>
      <PayrollContent />
    </Suspense>
  );
}

async function PayrollContent() {
  await connection();
  const session = await requireModule("payroll", "read");
  const db = getDb();
  const [overview, settings, memberships] = await Promise.all([
    getPayrollOverview(db, session.tenantId),
    loadPayrollSettings(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="payroll" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Paie</p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Paramétrage de la paie</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Les rubriques de paie décrivent chaque gain et chaque retenue d&apos;un bulletin. Le
              paramétrage fixe le jour de paiement et les taux de cotisation. Les bulletins et les
              périodes restent à venir.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href="/paie/rubriques"
              aria-label="Rubriques de paie"
              title="Rubriques de paie"
              className={ACTION_LINK}
            >
              <ListChecks className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/paie/parametres"
              aria-label="Paramètres de la paie"
              title="Paramètres de la paie"
              className={ACTION_LINK}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Contrats en cours</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.runningContracts}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Rubriques actives</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{overview.activeComponents}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Jour de paiement</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {settings ? settings.paymentDayOfMonth : 28}
            </dd>
          </div>
        </dl>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/paie/rubriques"
            className="group rounded-xl border border-line bg-panel p-5 transition-colors hover:border-brand/30"
          >
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Rubriques de paie</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Créer, corriger et activer les gains et les retenues qui composent un bulletin.
            </p>
          </Link>
          <Link
            href="/paie/parametres"
            className="group rounded-xl border border-line bg-panel p-5 transition-colors hover:border-brand/30"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Paramètres de la paie</h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Fixer le jour de paiement et les taux de cotisation salariale et patronale.
            </p>
          </Link>
        </section>

        <p className="mt-6 flex items-center gap-2 text-[10px] text-muted">
          <UserCog className="size-3.5" aria-hidden="true" />
          Les salariés et leurs contrats se gèrent depuis les ressources humaines.
          <Banknote className="size-3.5" aria-hidden="true" />
        </p>
      </main>
    </div>
  );
}
