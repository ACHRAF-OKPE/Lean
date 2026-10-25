import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Clock } from "lucide-react";
import type { ImportKind } from "@/db/schema";
import { AppHeader, type ActiveSection } from "@/components/app-header";
import { ImportUploader } from "@/components/import-uploader";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { IMPORT_KIND_LABELS, IMPORT_KIND_PATHS } from "@/modules/catalog/constants";
import { listImportBatches } from "@/modules/catalog/imports";
import { listMembershipsForUser } from "@/modules/identity/queries";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

const IMPORT_TITLES: Record<ImportKind, string> = {
  partners: "Importer des tiers",
  articles: "Importer des articles",
  hs_codes: "Importer la nomenclature",
  purchase_lines: "Importer des lignes de commande",
};

export async function ImportSection({ kind, active }: { kind: ImportKind; active: ActiveSection }) {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [memberships, history] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    listImportBatches(db, { tenantId: session.tenantId, kind }),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active={active} />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href={IMPORT_KIND_PATHS[kind]}
            aria-label={`Revenir à ${IMPORT_KIND_LABELS[kind].toLowerCase()}`}
            title="Revenir à la liste"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Import XLSX
            </p>
            <h1 className="text-2xl font-medium tracking-tight">{IMPORT_TITLES[kind]}</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Déposez votre fichier réel. Lean vérifie les en-têtes, chaque ligne et les références
          croisées, puis affiche le rapport avant toute écriture.
        </p>

        <ImportUploader kind={kind} />

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Derniers imports</h2>
            <Clock className="size-3.5 text-muted" aria-hidden="true" />
          </div>

          {history.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              Aucun import pour l&apos;instant dans cet espace.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Derniers imports du référentiel</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Fichier
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Lignes
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Erreurs
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Avertissements
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Statut
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-normal">
                      Rapport
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((batch) => (
                    <tr key={batch.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        <time dateTime={batch.createdAt.toISOString()}>
                          {dateFormatter.format(batch.createdAt)}
                        </time>
                      </td>
                      <td className="max-w-64 truncate px-4 py-2.5 font-medium">
                        {batch.fileName}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{batch.rowCount}</td>
                      <td className="px-4 py-2.5 text-copper tabular-nums">{batch.errorCount}</td>
                      <td className="px-4 py-2.5 text-muted tabular-nums">{batch.warningCount}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            batch.status === "applied"
                              ? "border-brand/15 bg-brand-soft text-brand-strong"
                              : "border-line bg-canvas text-muted"
                          }`}
                        >
                          {batch.status === "applied" ? "Appliqué" : "Analysé"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/imports/${batch.id}`}
                          aria-label={`Ouvrir le rapport de ${batch.fileName}`}
                          title="Ouvrir le rapport"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
