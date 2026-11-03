import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { TransferForm } from "@/components/stock-forms";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listInternalLocations } from "@/modules/stock/locations";
import { listProductOptions } from "@/modules/stock/queries";

export const metadata: Metadata = {
  title: "Nouveau transfert",
};

export default function NewTransferPage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du transfert…" />}>
      <NewTransferContent />
    </Suspense>
  );
}

async function NewTransferContent() {
  await connection();
  const session = await requireModule("stock", "write");
  const db = getDb();
  const [locations, articles, memberships] = await Promise.all([
    listInternalLocations(db, session.tenantId),
    listProductOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

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
            <h1 className="text-2xl font-medium tracking-tight">Nouveau transfert</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Un transfert déplace une quantité d&apos;un magasin interne actif vers un autre. Le stock
          disponible baisse à l&apos;origine et monte à la destination, en une seule écriture
          numérotée. Un même article ne peut apparaître qu&apos;une fois.
        </p>

        {locations.length < 2 ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Un transfert exige au moins deux magasins internes actifs. Créez-en un depuis la page
            Magasins.
          </p>
        ) : null}

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Mouvement à créer</h2>
          </div>
          <TransferForm locations={locations} articles={articles} today={todayIsoDate()} />
        </section>
      </main>
    </div>
  );
}
