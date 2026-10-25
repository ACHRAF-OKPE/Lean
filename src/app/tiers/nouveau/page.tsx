import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { PartnerForm } from "./partner-form";

export const metadata: Metadata = {
  title: "Nouveau tiers",
};

export default function NewPartnerPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewPartnerContent />
    </Suspense>
  );
}

async function NewPartnerContent() {
  await connection();
  const session = await requirePermission("data.write");
  const memberships = await listMembershipsForUser(getDb(), session.userId);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/tiers"
            aria-label="Revenir aux tiers"
            title="Revenir aux tiers"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouveau tiers</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Créez un client ou un fournisseur. Le code doit être unique dans l&apos;espace actif ;
          pour plusieurs fiches, utilisez l&apos;import XLSX avec rapport de vérification.
        </p>

        <PartnerForm />
      </main>
    </div>
  );
}
