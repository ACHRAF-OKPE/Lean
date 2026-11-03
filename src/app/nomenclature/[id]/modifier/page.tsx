import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { getHsCodeDetail } from "@/modules/catalog/hs-code-queries";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HsCodeEditForm } from "./hs-code-edit-form";

export const metadata: Metadata = {
  title: "Modifier un code SH",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function HsCodeEditPage(props: PageProps<"/nomenclature/[id]/modifier">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <HsCodeEditContent params={props.params} />
    </Suspense>
  );
}

async function HsCodeEditContent({
  params,
}: Pick<PageProps<"/nomenclature/[id]/modifier">, "params">) {
  await connection();
  const session = await requireModule("nomenclature", "write");
  const { id: hsCodeId } = await params;
  if (!UUID_PATTERN.test(hsCodeId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships] = await Promise.all([
    getHsCodeDetail(db, { tenantId: session.tenantId, hsCodeId }),
    listMembershipsForUser(db, session.userId),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="nomenclature" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href={`/nomenclature/${detail.id}`}
            aria-label="Revenir à la fiche"
            title="Revenir à la fiche"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              {detail.code}
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Modifier le code SH</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Chaque modification remplace la valeur précédente et laisse une trace d&apos;audit. Le
          code de la fiche reste immuable.
        </p>

        <HsCodeEditForm
          hsCode={{
            id: detail.id,
            code: detail.code,
            wording: detail.wording,
            parentCode: detail.parentCode,
            supplementaryUnit: detail.supplementaryUnit,
            tecRate: detail.tecRate,
          }}
        />
      </main>
    </div>
  );
}
