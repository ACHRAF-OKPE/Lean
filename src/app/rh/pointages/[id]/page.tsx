import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Fingerprint, Lock, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { TimeEntryStatusBadge } from "@/components/hr-badges";
import {
  DeleteTimeEntryButton,
  ReopenTimeEntryButton,
  TimeEntryForm,
  ValidateTimeEntryButton,
} from "@/components/hr-time-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import type { HrTimeEntryKind, HrTimeEntryPeriod } from "@/db/schema";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_LIST_LIMIT,
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
} from "@/modules/hr/constants";
import { listEmployees } from "@/modules/hr/queries";
import { entryHalfDays, formatHalfDays, formatHours } from "@/modules/hr/time";
import {
  getExpectedPeriod,
  getPunchExpectation,
  getTimeEntry,
  listTimeEntries,
} from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Ligue de pointage",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La borne haute des filtres de lecture est exclusive : on la pousse au lendemain du jour choisi. */
function nextIsoDay(isoDate: string): string {
  const next = new Date(`${isoDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export default function TimeEntryPage(props: PageProps<"/rh/pointages/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du pointage…" />}>
      <TimeEntryContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TimeEntryContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/pointages/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const canWrite = await canAccessModule(session, "hr", "write");
  const canManage = await canAccessModule(session, "hr", "manage");
  const today = todayIsoDate();
  const [entry, memberships, query] = await Promise.all([
    getTimeEntry(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!entry) {
    notFound();
  }

  const [employees, dayEntries, expected, expectation] = await Promise.all([
    canWrite
      ? listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT })
      : Promise.resolve([]),
    listTimeEntries(db, {
      tenantId: session.tenantId,
      employeeId: entry.employeeId,
      from: entry.workDate,
      to: nextIsoDay(entry.workDate),
    }),
    getExpectedPeriod(db, session.tenantId, {
      employeeId: entry.employeeId,
      from: entry.workDate,
      to: entry.workDate,
    }),
    getPunchExpectation(db, session.tenantId, { from: entry.workDate, to: entry.workDate }),
  ]);

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const draft = entry.status === "draft";
  const label = `${entry.employeeCode} · ${entry.workDate}`;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/pointages"
            aria-label="Revenir aux pointages"
            title="Revenir aux pointages"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ligue de pointage
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {entry.employeeName}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {entry.employeeCode} · {isoDateLabel(entry.workDate)}
            </p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-1.5">
              {draft ? (
                <ValidateTimeEntryButton entryId={entry.id} label={label} />
              ) : (
                <ReopenTimeEntryButton entryId={entry.id} label={label} />
              )}
              {draft ? <DeleteTimeEntryButton entryId={entry.id} label={label} /> : null}
            </div>
          ) : null}
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created
              ? "Ligue créée en brouillon."
              : draft
                ? "Ligue mise à jour."
                : "Ligue revenue au brouillon ou validée."}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TimeEntryStatusBadge status={entry.status} />
          {draft ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <ShieldAlert className="size-3" aria-hidden="true" />
              Brouillon : la validation demande le niveau gestion.
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <Lock className="size-3" aria-hidden="true" />
              Validée : une correction passe d&apos;abord par un retour au brouillon.
            </span>
          )}
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Nature</dt>
            <dd className="mt-1 text-[12px]">
              {HR_TIME_ENTRY_KIND_LABELS[entry.kind as HrTimeEntryKind]}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Période</dt>
            <dd className="mt-1 text-[12px]">
              {HR_TIME_ENTRY_PERIOD_LABELS[entry.period as HrTimeEntryPeriod]}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Heures</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {entry.hours ? `${formatHours(Number(entry.hours))} h` : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3 sm:col-span-2">
            <dt className="text-[10px] text-muted">Motif</dt>
            <dd className="mt-1 text-[12px] break-words">{entry.note ?? "—"}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Ce jour-là</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {formatHalfDays(expected.halfDays)} demi-journée(s) attendue(s)
            </dd>
          </div>
        </dl>

        <section className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
          <h2 className="text-[11px] font-semibold">Salarié</h2>
          <p className="mt-2 text-[12px]">
            <Link
              href={`/rh/personnel/${entry.employeeId}`}
              className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
            >
              {entry.employeeName} · {entry.employeeCode}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </p>
          <p className="mt-2 text-[10px] leading-4 text-muted">
            Les ligues du {isoDateLabel(entry.workDate)} pour cette fiche : {dayEntries.length}{" "}
            ligne(s),{" "}
            {formatHalfDays(
              dayEntries.reduce(
                (total, line) => total + entryHalfDays(line.period as HrTimeEntryPeriod),
                0,
              ),
            )}{" "}
            demi-journée(s) portées. Un jour ne peut porter deux fois la même période ; les heures,
            elles, se cumulent dans la limite du calendrier.
          </p>
        </section>

        {canWrite ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4" open={draft}>
            <summary className="cursor-pointer text-sm font-semibold">
              {draft ? "Modifier le brouillon" : "Caractéristiques de la ligue"}
            </summary>
            <div className="mt-4">
              {draft ? (
                <TimeEntryForm
                  mode="edit"
                  entryId={entry.id}
                  today={today}
                  employees={employees
                    .filter((employee) => employee.status !== "left")
                    .map((employee) => ({
                      id: employee.id,
                      code: employee.code,
                      fullName: employee.fullName,
                    }))}
                  expectation={expectation}
                  entry={{
                    employeeId: entry.employeeId,
                    workDate: entry.workDate,
                    kind: entry.kind,
                    period: entry.period,
                    hours: entry.hours ?? "",
                    note: entry.note ?? "",
                  }}
                />
              ) : (
                <p className="text-[11px] leading-5 text-muted">
                  <Fingerprint className="mr-1 inline size-3.5 text-brand" aria-hidden="true" />
                  Ligue validée : reprenez-la au brouillon en gestion pour la corriger.
                </p>
              )}
            </div>
          </details>
        ) : (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Lecture seule : saisir ou corriger une ligue demande le niveau écriture sur le module RH
            ; la valider, la reprendre au brouillon ou la supprimer relève de la gestion.
          </p>
        )}
      </main>
    </div>
  );
}
