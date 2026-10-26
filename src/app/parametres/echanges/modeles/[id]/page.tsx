import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getExchangeTemplate } from "@/modules/exchange/queries";
import { TemplateForm } from "../../template-form";

export const metadata: Metadata = {
  title: "Modifier le modèle d'échange",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditExchangeTemplatePage(
  props: PageProps<"/parametres/echanges/modeles/[id]">,
) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du modèle…" />}>
      <EditExchangeTemplateContent params={props.params} />
    </Suspense>
  );
}

async function EditExchangeTemplateContent({
  params,
}: Pick<PageProps<"/parametres/echanges/modeles/[id]">, "params">) {
  await connection();
  const session = await requirePermission("settings.manage");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const [template, memberships] = await Promise.all([
    getExchangeTemplate(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!template) {
    notFound();
  }

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
            <h1 className="mt-2 text-2xl font-medium tracking-tight">{template.name}</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              La modification ne change aucun message déjà journalisé : elle s&apos;applique aux
              envois suivants. Un modèle se désactive, il ne se supprime pas.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <TemplateForm template={template} />
        </div>
      </main>
    </div>
  );
}
