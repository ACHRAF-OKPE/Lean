import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getCustomerOptions, getSalesArticleOptions } from "@/modules/sales/queries";
import { SalesOrderForm } from "./order-form";

export const metadata: Metadata = {
  title: "Nouvelle commande client",
};

export default function NewSalesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewSalesContent />
    </Suspense>
  );
}

async function NewSalesContent() {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [customers, articles, memberships] = await Promise.all([
    getCustomerOptions(db, session.tenantId),
    getSalesArticleOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const blocked = customers.length === 0 || articles.length === 0;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="sales" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/ventes"
            aria-label="Revenir aux ventes"
            title="Revenir aux ventes"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Ventes</p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle commande client</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          La commande est créée en brouillon. Elle ne reçoit son numéro qu&apos;à la confirmation ;
          une livraison exige une commande confirmée et du stock disponible.
        </p>

        {blocked ? (
          <div className="mt-6 flex gap-2 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Référentiel incomplet.</p>
              <p className="mt-0.5">
                Une commande exige au moins un client actif et un article vendable.{" "}
                {customers.length === 0 ? (
                  <Link href="/tiers/nouveau" className="underline underline-offset-2">
                    Créer un client
                  </Link>
                ) : null}
                {customers.length === 0 && articles.length === 0 ? " ou " : null}
                {articles.length === 0 ? (
                  <Link href="/articles/nouveau" className="underline underline-offset-2">
                    créer un article vendable
                  </Link>
                ) : null}
                .
              </p>
            </div>
          </div>
        ) : (
          <SalesOrderForm customers={customers} articles={articles} />
        )}
      </main>
    </div>
  );
}
