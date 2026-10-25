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
import { HsCodeForm } from "./hs-code-form";

export const metadata: Metadata = {
  title: "Nouveau code SH",
};

export default function NewHsCodePage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewHsCodeContent />
    </Suspense>
  );
}

async function NewHsCodeContent() {
  await connection();
  const session = await requirePermission("data.write");
  const memberships = await listMembershipsForUser(getDb(), session.userId);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="nomenclature" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/nomenclature"
            aria-label="Revenir à la nomenclature"
            title="Revenir à la nomenclature"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouveau code SH</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Créez un code de nomenclature. Le parent, s&apos;il est renseigné, doit être un préfixe
          strict déjà présent dans l&apos;espace actif.
        </p>

        <HsCodeForm />
      </main>
    </div>
  );
}
