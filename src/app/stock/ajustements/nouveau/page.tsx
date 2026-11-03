import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { AdjustmentForm } from "@/components/stock-forms";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listInternalLocations } from "@/modules/stock/locations";
import { listProductOptions } from "@/modules/stock/queries";
import { loadStockSettings } from "@/modules/stock/settings";

export const metadata: Metadata = {
  title: "Nouvel ajustement d'inventaire",
};

export default function NewAdjustmentPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de l'ajustement…" />}>
      <NewAdjustmentContent />
    </Suspense>
  );
}

async function NewAdjustmentContent() {
  await connection();
  const session = await requireModule("stock", "write");
  const db = getDb();
  const [locations, articles, settings, memberships] = await Promise.all([
    listInternalLocations(db, session.tenantId),
    listProductOptions(db, session.tenantId),
    loadStockSettings(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const reasonRequired = settings?.adjustmentReasonRequired ?? true;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/stock/registre"
            aria-label="Revenir au registre"
            title="Revenir au registre"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Stock</p>
            <h1 className="text-2xl font-medium tracking-tight">
              Nouvel ajustement d&apos;inventaire
            </h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Un ajustement corrige le stock constaté. Il passe toujours par l&apos;emplacement virtuel
          d&apos;inventaire : une entrée enregistre un excédent, une sortie un manquant. Le
          mouvement reste dans le journal et ne supprime jamais un mouvement antérieur.
        </p>

        {locations.length === 0 ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Aucun magasin interne actif : un ajustement exige un magasin pour porter le constat.
          </p>
        ) : null}

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Constat d&apos;inventaire</h2>
          </div>
          <AdjustmentForm
            locations={locations}
            articles={articles}
            today={todayIsoDate()}
            reasonRequired={reasonRequired}
          />
        </section>
      </main>
    </div>
  );
}
