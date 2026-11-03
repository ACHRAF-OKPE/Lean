import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { listHsCodeOptions } from "@/modules/catalog/queries";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ArticleForm } from "./article-form";

export const metadata: Metadata = {
  title: "Nouvel article",
};

export default function NewArticlePage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewArticleContent />
    </Suspense>
  );
}

async function NewArticleContent() {
  await connection();
  const session = await requireModule("articles", "write");
  const db = getDb();
  const [memberships, hsCodes, levels] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    listHsCodeOptions(db, session.tenantId),
    getAccessLevels(session),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="articles" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/articles"
            aria-label="Revenir aux articles"
            title="Revenir aux articles"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Référentiel
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvel article</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Créez un produit ou un service. Un produit porte un code SH, cherché par code ou par
          libellé dans la nomenclature et créé à la volée au besoin ; un service ne porte jamais de
          code SH.
        </p>

        <ArticleForm hsCodes={hsCodes} canCreateHsCode={atLeast(levels.nomenclature, "write")} />
      </main>
    </div>
  );
}
