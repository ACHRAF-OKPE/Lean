import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, FileSearch, SlidersHorizontal } from "lucide-react";
import { PostedBadge } from "@/components/accounting-badges";
import { AppHeader } from "@/components/app-header";
import { PostCutoffButton } from "@/components/accounting-forms";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { CUTOFF_DOCUMENT_KIND_LABELS, getCutoffReport } from "@/modules/accounting/cutoff";
import { listFiscalYears } from "@/modules/accounting/queries";

export const metadata: Metadata = {
  title: "Rapprochement comptable",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function CutoffPage(props: PageProps<"/comptabilite/rapprochement">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du rapprochement…" />}>
      <CutoffContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function CutoffContent({
  searchParams,
}: Pick<PageProps<"/comptabilite/rapprochement">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [years, memberships, query] = await Promise.all([
    listFiscalYears(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  const requestedYear = typeof query.exercice === "string" ? query.exercice : null;
  const selectedYear =
    years.find((year) => year.id === requestedYear) ??
    years.find((year) => year.status === "open") ??
    years[0] ??
    null;
  const report = selectedYear
    ? await getCutoffReport(db, { tenantId: session.tenantId, fiscalYearId: selectedYear.id })
    : null;
  const canWrite = can(session.role, "data.write");
  const postedCount = typeof query.comptabilise === "string" ? Number(query.comptabilise) : 0;
  const justPosted = Number.isSafeInteger(postedCount) && postedCount > 0;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/comptabilite"
            aria-label="Revenir à la comptabilité"
            title="Revenir à la comptabilité"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Comptabilité
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Rapprochement de cut-off</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Inventaire des factures, règlements et réceptions de l&apos;exercice et de leur
          comptabilisation. Les documents antérieurs au paramétrage restent en attente :
          comptabilisez-les ici pour rattraper le retard avant la clôture.
        </p>

        {justPosted ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {postedCount} document{postedCount > 1 ? "s" : ""} comptabilisé
            {postedCount > 1 ? "s" : ""}.
          </p>
        ) : null}

        <form
          method="get"
          className="mt-5 grid gap-3 rounded-xl border border-line bg-panel p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        >
          <Field label="Exercice" htmlFor="cutoff-year" hint="Exercice comptable analysé.">
            <select
              id="cutoff-year"
              name="exercice"
              required
              defaultValue={selectedYear?.id ?? ""}
              className={INPUT_CLASS}
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            aria-label="Afficher le rapprochement"
            title="Afficher le rapprochement"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <FileSearch className="size-4" aria-hidden="true" />
          </button>
        </form>

        {years.length === 0 ? (
          <div className="mt-4 rounded-xl border border-line bg-panel px-5 py-12 text-center">
            <FileSearch className="mx-auto size-6 text-brand" aria-hidden="true" />
            <p className="mt-3 text-[11px] leading-5 text-muted">
              Aucun exercice comptable.{" "}
              <Link href="/comptabilite/exercices" className="underline">
                Ouvrez un exercice
              </Link>{" "}
              pour analyser le cut-off.
            </p>
          </div>
        ) : report === null ? null : (
          <>
            {report.configured ? null : (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
                <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
                <p className="flex-1">
                  Comptabilité automatique non paramétrée : aucune écriture n&apos;est générée et
                  les documents de l&apos;exercice restent en attente.
                </p>
                <Link
                  href="/comptabilite/parametres"
                  className="rounded-md border border-copper/30 px-2 py-1 font-medium hover:bg-copper/10"
                >
                  Paramétrer
                </Link>
              </div>
            )}

            <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Exercice</dt>
                <dd className="mt-1 text-sm font-medium">{report.fiscalYear.label}</dd>
                <dd className="font-mono text-[10px] text-muted tabular-nums">
                  {isoDateLabel(report.fiscalYear.startsOn)} —{" "}
                  {isoDateLabel(report.fiscalYear.endsOn)}
                </dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Documents</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">{report.documents.length}</dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">Comptabilisés</dt>
                <dd className="mt-1 font-mono text-lg text-brand-strong tabular-nums">
                  {report.postedCount}
                </dd>
              </div>
              <div className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[10px] text-muted">En attente</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">{report.unpostedCount}</dd>
                <dd className="text-[10px] text-muted tabular-nums">
                  {formatXof(report.unpostedAmountXof)}
                </dd>
              </div>
            </dl>

            <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <FileSearch className="size-4 text-brand" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Documents de l&apos;exercice</h2>
                {canWrite && report.configured ? (
                  <div className="ml-auto">
                    <PostCutoffButton
                      fiscalYearId={report.fiscalYear.id}
                      unpostedCount={report.unpostedCount}
                    />
                  </div>
                ) : null}
              </div>
              {report.documents.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <FileSearch className="mx-auto size-6 text-brand" aria-hidden="true" />
                  <p className="mt-3 text-[11px] leading-5 text-muted">
                    Aucun document comptabilisable sur cet exercice.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <caption className="sr-only">
                      Documents comptabilisables de {report.fiscalYear.label}
                    </caption>
                    <thead>
                      <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                        <th scope="col" className={TH}>
                          Date
                        </th>
                        <th scope="col" className={TH}>
                          Type
                        </th>
                        <th scope="col" className={TH}>
                          Pièce
                        </th>
                        <th scope="col" className={TH}>
                          Tiers
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Montant
                        </th>
                        <th scope="col" className={TH}>
                          État
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Écriture
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.documents.map((document) => (
                        <tr
                          key={`${document.kind}-${document.documentId}`}
                          className="border-b border-line last:border-b-0"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                            {isoDateLabel(document.date)}
                          </td>
                          <td className="px-4 py-2.5 text-[10px] text-muted">
                            {CUTOFF_DOCUMENT_KIND_LABELS[document.kind]}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                            {document.number ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">{document.partnerName ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {formatXof(document.amountXof)}
                          </td>
                          <td className="px-4 py-2.5">
                            <PostedBadge posted={document.posted} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {document.entryId ? (
                              <Link
                                href={`/comptabilite/ecritures/${document.entryId}`}
                                aria-label={`Ouvrir l'écriture ${document.entryNumber ?? ""}`}
                                title="Ouvrir l'écriture"
                                className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                              >
                                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                              </Link>
                            ) : (
                              <span className="block text-right text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
