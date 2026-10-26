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
import { TemplateForm } from "../../template-form";

export const metadata: Metadata = {
  title: "Nouveau modèle d'échange",
};

export default function NewExchangeTemplatePage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du modèle…" />}>
      <NewExchangeTemplateContent />
    </Suspense>
  );
}

async function NewExchangeTemplateContent() {
  await connection();
  const session = await requirePermission("settings.manage");
  const memberships = await listMembershipsForUser(getDb(), session.userId);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="settings" />
      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/parametres/echanges"
            aria-label="Revenir aux échanges"
            title="Revenir aux échanges"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Échanges · modèle
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Nouveau modèle</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Composez le sujet et le corps avec les variables proposées. L&apos;aperçu utilise des
              valeurs d&apos;exemple ; l&apos;envoi les remplace par celles de la commande.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <TemplateForm template={null} />
        </div>
      </main>
    </div>
  );
}
