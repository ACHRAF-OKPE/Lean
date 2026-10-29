import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getArticleOptions } from "@/modules/purchases/queries";
import { getTenderSupplierOptions } from "@/modules/tenders/queries";
import { TenderForm } from "../tender-form";

export const metadata: Metadata = {
  title: "Nouvelle demande de cotation",
};

export default function NewTenderPage() {
  return (
    <Suspense fallback={<LoadingShell label="Préparation du brouillon…" />}>
      <NewTenderContent />
    </Suspense>
  );
}

async function NewTenderContent() {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [suppliers, articles, memberships] = await Promise.all([
    getTenderSupplierOptions(db, session.tenantId),
    getArticleOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tenders" />
      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
          Achats · Appels d&apos;offres
        </p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Nouvelle demande de cotation</h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
          Le brouillon reste modifiable et supprimable. À l&apos;envoi, un numéro DAO est attribué,
          les lignes sont figées et chaque fournisseur reçoit son lien personnel.
        </p>
        <TenderForm mode="create" suppliers={suppliers} articles={articles} />
      </main>
    </div>
  );
}
