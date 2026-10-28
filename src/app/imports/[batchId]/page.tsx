import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
} from "lucide-react";
import type { ImportKind, ImportRowStatus } from "@/db/schema";
import { AppHeader, type ActiveSection } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { IMPORT_KIND_LABELS, IMPORT_KIND_PATHS } from "@/modules/catalog/constants";
import { getImportBatch } from "@/modules/catalog/imports";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { ApplyImportForm } from "./apply-form";

export const metadata: Metadata = {
  title: "Rapport d'import",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 100;

const ACTIVE_BY_KIND: Record<ImportKind, ActiveSection> = {
  partners: "partners",
  articles: "articles",
  hs_codes: "nomenclature",
  purchase_lines: "purchases",
  sales_lines: "sales",
  tasks: "tasks",
};

const ROW_STATUS_META: Record<
  ImportRowStatus,
  { readonly label: string; readonly icon: typeof CircleCheck; readonly className: string }
> = {
  valid: {
    label: "Valide",
    icon: CircleCheck,
    className: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  warning: {
    label: "Avertissement",
    icon: TriangleAlert,
    className: "border-copper/15 bg-copper-soft text-copper",
  },
  error: {
    label: "Erreur",
    icon: CircleX,
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

const TH = "px-4 py-2.5 font-normal";

export default function ImportReportPage(props: PageProps<"/imports/[batchId]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du rapport…" />}>
      <ImportReportContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ImportReportContent({
  params,
  searchParams,
}: Pick<PageProps<"/imports/[batchId]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { batchId } = await params;
  if (!UUID_PATTERN.test(batchId)) {
    notFound();
  }

  const db = getDb();
  const [detail, memberships, query] = await Promise.all([
    getImportBatch(db, { tenantId: session.tenantId, batchId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!detail) {
    notFound();
  }

  const { batch, rows: allRows } = detail;
  const validCount = Math.max(batch.rowCount - batch.errorCount - batch.warningCount, 0);
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const requestedPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : 1;
  const currentPage = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleRows = allRows.slice(start, start + PAGE_SIZE);
  const listPath = IMPORT_KIND_PATHS[batch.kind];
  const kindLabel = IMPORT_KIND_LABELS[batch.kind];

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active={ACTIVE_BY_KIND[batch.kind]} />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`${listPath}/import`}
            aria-label="Revenir à l'import"
            title="Revenir à l'import"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Rapport d&apos;analyse
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Import — {kindLabel}</h1>
          </div>
          <span
            className={`ml-auto rounded-full border px-2.5 py-1 text-[10px] font-medium ${
              batch.status === "applied"
                ? "border-brand/15 bg-brand-soft text-brand-strong"
                : "border-line bg-panel text-muted"
            }`}
          >
            {batch.status === "applied" ? "Appliqué" : "En attente de confirmation"}
          </span>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-muted">
          <span className="font-mono text-[10px] text-ink">{batch.fileName}</span>
          <span className="mx-1.5">·</span>
          Feuille « {batch.sheetName} »<span className="mx-1.5">·</span>
          Analysé le{" "}
          <time dateTime={batch.createdAt.toISOString()}>
            {dateFormatter.format(batch.createdAt)}
          </time>
        </p>

        {batch.notes.length > 0 ? (
          <section className="mt-4 rounded-lg border border-line bg-panel px-4 py-3">
            <div className="flex items-center gap-2">
              <Info className="size-3.5 text-brand" aria-hidden="true" />
              <h2 className="text-[11px] font-semibold">Notes d&apos;analyse</h2>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] leading-4 text-muted">
              {batch.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <dt className="text-[10px] text-muted">Lignes</dt>
            <dd className="mt-0.5 font-mono text-lg tabular-nums">{batch.rowCount}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <dt className="text-[10px] text-muted">Valides</dt>
            <dd className="mt-0.5 font-mono text-lg text-brand-strong tabular-nums">
              {validCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <dt className="text-[10px] text-muted">Avertissements</dt>
            <dd className="mt-0.5 font-mono text-lg text-copper tabular-nums">
              {batch.warningCount}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <dt className="text-[10px] text-muted">Erreurs</dt>
            <dd
              className={`mt-0.5 font-mono text-lg tabular-nums ${
                batch.errorCount > 0 ? "text-red-700" : ""
              }`}
            >
              {batch.errorCount}
            </dd>
          </div>
        </dl>

        {batch.status === "applied" ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3">
            <p className="text-[11px] text-brand-strong">
              Import appliqué
              {batch.appliedAt ? (
                <>
                  {" "}
                  le{" "}
                  <time dateTime={batch.appliedAt.toISOString()}>
                    {dateFormatter.format(batch.appliedAt)}
                  </time>
                </>
              ) : null}
              . Les lignes ont été écrites dans
              {batch.kind === "purchase_lines"
                ? " des commandes fournisseur en brouillon."
                : batch.kind === "sales_lines"
                  ? " des commandes client en brouillon."
                  : batch.kind === "tasks"
                    ? " des tâches ouvertes."
                    : " le référentiel."}
            </p>
            <Link
              href={listPath}
              aria-label={`Ouvrir ${kindLabel.toLowerCase()}`}
              title={`Ouvrir ${kindLabel.toLowerCase()}`}
              className="grid size-8 place-items-center rounded-md border border-brand/20 bg-panel text-brand-strong transition-colors hover:border-brand/40"
            >
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        ) : batch.errorCount > 0 ? (
          <p className="mt-4 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            Corrigez les lignes en erreur dans le fichier, relancez l&apos;analyse puis confirmez.
            Aucune donnée métier n&apos;a été écrite.
          </p>
        ) : (
          <ApplyImportForm batchId={batch.id} count={batch.rowCount - batch.errorCount} />
        )}

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Vérification ligne à ligne</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">
                Résultat de vérification de chaque ligne importée
              </caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Ligne
                  </th>
                  <th scope="col" className={TH}>
                    Code
                  </th>
                  <th scope="col" className={TH}>
                    Statut
                  </th>
                  <th scope="col" className={TH}>
                    Messages
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const meta = ROW_STATUS_META[row.status];
                  const Icon = meta.icon;
                  return (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap text-muted tabular-nums">
                        {row.rowNumber}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {row.code ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${meta.className}`}
                        >
                          <Icon className="size-3" aria-hidden="true" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {row.errors.length === 0 && row.warnings.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <div className="max-w-3xl space-y-1">
                            {row.errors.map((message) => (
                              <p key={message} className="text-[10px] leading-4 text-red-700">
                                {message}
                              </p>
                            ))}
                            {row.warnings.map((message) => (
                              <p key={message} className="text-[10px] leading-4 text-copper">
                                {message}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 ? (
          <nav
            aria-label="Pagination du rapport"
            className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted"
          >
            {currentPage > 1 ? (
              <Link
                href={`/imports/${batch.id}?page=${currentPage - 1}`}
                aria-label="Page précédente"
                title="Page précédente"
                className="grid size-8 place-items-center rounded-md border border-line bg-panel transition-colors hover:border-brand/30 hover:text-brand"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span aria-disabled="true" className="grid size-8 place-items-center opacity-40">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </span>
            )}

            <p>
              Lignes {start + 1}–{Math.min(start + PAGE_SIZE, allRows.length)} sur {allRows.length}{" "}
              · page {currentPage}/{totalPages}
            </p>

            {currentPage < totalPages ? (
              <Link
                href={`/imports/${batch.id}?page=${currentPage + 1}`}
                aria-label="Page suivante"
                title="Page suivante"
                className="grid size-8 place-items-center rounded-md border border-line bg-panel transition-colors hover:border-brand/30 hover:text-brand"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span aria-disabled="true" className="grid size-8 place-items-center opacity-40">
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            )}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
