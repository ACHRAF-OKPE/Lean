import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Pencil } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { HsCodeDeleteButton } from "@/components/views/hs-code-delete-button";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { hsLevel, type HsLevel } from "@/modules/catalog/hs-codes";
import { getHsCodeDetail } from "@/modules/catalog/hs-code-queries";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Fiche code SH",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEVEL_LABELS: Record<HsLevel, string> = {
  6: "Position (6 chiffres)",
  8: "Sous-position (8 chiffres)",
  10: "Ligne (10 chiffres)",
};

function bannerFor(query: Record<string, string | string[] | undefined>): string | null {
  if (query.maj === "ok") {
    return "Fiche mise à jour ; le changement est audité.";
  }
  return null;
}

export default function HsCodeDetailPage(props: PageProps<"/nomenclature/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la fiche…" />}>
      <HsCodeDetailContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function HsCodeDetailContent({
  params,
  searchParams,
}: Pick<PageProps<"/nomenclature/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("nomenclature", "read");
  const { id: hsCodeId } = await params;
  if (!UUID_PATTERN.test(hsCodeId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships, levels, query] = await Promise.all([
    getHsCodeDetail(db, { tenantId: session.tenantId, hsCodeId }),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    searchParams,
  ]);

  if (!detail) {
    notFound();
  }

  const level = levels.nomenclature;
  const canWrite = atLeast(level, "write");
  const canManage = atLeast(level, "manage");
  const banner = bannerFor(query);
  const hsLevelValue = hsLevel(detail.code);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="nomenclature" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <Link
          href="/nomenclature"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Toute la nomenclature
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Code SH</p>
            <h1 className="mt-2 font-mono text-2xl font-medium tracking-tight">{detail.code}</h1>
            <p className="mt-1 text-[11px] text-muted">{detail.wording}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] ${
                detail.tecRate === null
                  ? "border-copper/15 bg-copper-soft text-copper"
                  : "border-brand/15 bg-brand-soft text-brand-strong"
              }`}
            >
              {detail.tecRate === null ? "TEC manquant" : `TEC ${detail.tecRate} %`}
            </span>
            {canWrite ? (
              <Link
                href={`/nomenclature/${detail.id}/modifier`}
                aria-label="Modifier le code SH"
                title="Modifier le code SH"
                className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
            {canManage ? <HsCodeDeleteButton hsCodeId={detail.id} code={detail.code} /> : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            {banner}
          </p>
        ) : null}

        <section
          aria-label="Informations du code SH"
          className="mt-6 grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Niveau</p>
            <p className="mt-1 text-[11px]">
              {hsLevelValue === null ? "Non conforme" : LEVEL_LABELS[hsLevelValue]}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Code parent
            </p>
            {detail.parent ? (
              <Link
                href={`/nomenclature/${detail.parent.id}`}
                className="mt-1 inline-block font-mono text-[11px] text-brand-strong transition-opacity hover:opacity-80"
              >
                {detail.parent.code}
              </Link>
            ) : (
              <p className="mt-1 text-[11px] text-muted">Aucun</p>
            )}
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Unité complémentaire
            </p>
            <p className="mt-1 text-[11px]">{detail.supplementaryUnit ?? "Non renseignée"}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Taux TEC</p>
            <p className="mt-1 text-[11px] tabular-nums">
              {detail.tecRate === null ? "Non renseigné" : `${detail.tecRate} %`}
            </p>
          </div>
        </section>

        <section
          aria-label="Codes enfants"
          className="mt-6 overflow-hidden rounded-xl border border-line bg-panel"
        >
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Codes enfants</h2>
          </div>
          {detail.children.length === 0 ? (
            <p className="px-5 py-6 text-[11px] text-muted">
              Aucun code enfant ne se rattache à ce code.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {detail.children.map((child) => (
                <li key={child.id} className="flex items-center gap-2 px-5 py-2.5 text-[11px]">
                  <Link
                    href={`/nomenclature/${child.id}`}
                    className="font-mono text-[10px] text-brand-strong transition-opacity hover:opacity-80"
                  >
                    {child.code}
                  </Link>
                  <span>{child.wording}</span>
                  <span className="ml-auto text-[10px] text-muted tabular-nums">
                    {child.tecRate === null ? "TEC manquant" : `TEC ${child.tecRate} %`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Utilisation du code"
          className="mt-6 overflow-hidden rounded-xl border border-line bg-panel"
        >
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Qui l&apos;utilise</h2>
          </div>
          <div className="px-5 py-4">
            <p className="text-[11px] text-muted">
              {detail.usage.articles.length} article
              {detail.usage.articles.length > 1 ? "s" : ""} · {detail.usage.declarationLines} ligne
              {detail.usage.declarationLines > 1 ? "s" : ""} de déclaration
            </p>
            {detail.usage.articles.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {detail.usage.articles.map((article) => (
                  <li key={article.id}>
                    <Link
                      href={`/articles/${article.id}`}
                      className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-brand/30 hover:text-brand"
                    >
                      {article.code} · {article.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
