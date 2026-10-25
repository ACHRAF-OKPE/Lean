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
import { getArticleOptions, getSupplierOptions } from "@/modules/purchases/queries";
import { PurchaseOrderForm } from "./order-form";

export const metadata: Metadata = {
  title: "Nouvelle commande",
};

export default function NewPurchasePage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewPurchaseContent />
    </Suspense>
  );
}

async function NewPurchaseContent() {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [suppliers, articles, memberships] = await Promise.all([
    getSupplierOptions(db, session.tenantId),
    getArticleOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const blocked = suppliers.length === 0 || articles.length === 0;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="purchases" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
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
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle commande</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          La commande est créée en brouillon. Elle ne reçoit son numéro qu&apos;à la confirmation et
          n&apos;accepte une réception qu&apos;une fois confirmée.
        </p>

        {blocked ? (
          <div className="mt-6 flex gap-2 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Référentiel incomplet.</p>
              <p className="mt-0.5">
                Une commande exige au moins un fournisseur actif et un article achetable.{" "}
                {suppliers.length === 0 ? (
                  <Link href="/tiers/nouveau" className="underline underline-offset-2">
                    Créer un fournisseur
                  </Link>
                ) : null}
                {suppliers.length === 0 && articles.length === 0 ? " ou " : null}
                {articles.length === 0 ? (
                  <Link href="/articles/nouveau" className="underline underline-offset-2">
                    créer un article
                  </Link>
                ) : null}
                .
              </p>
            </div>
          </div>
        ) : (
          <PurchaseOrderForm suppliers={suppliers} articles={articles} />
        )}
      </main>
    </div>
  );
}
