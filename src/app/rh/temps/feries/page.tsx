import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CalendarOff, Filter, Plus, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DeletePublicHolidayButton, PublicHolidayForm } from "@/components/hr-time-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import type { HrDayPeriod } from "@/db/schema";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import {
  HR_DAY_PERIOD_LABELS,
  HR_HOLIDAY_KIND_LABELS,
  isHrHolidayKind,
} from "@/modules/hr/constants";
import { holidayYears, listPublicHolidays } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Jours fériés et chômés",
};

const TH = "px-4 py-2.5 font-normal";
const CONTROL =
  "rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function kindLabel(kind: string): string {
  return isHrHolidayKind(kind) ? HR_HOLIDAY_KIND_LABELS[kind] : kind;
}

export default function PublicHolidaysPage(props: PageProps<"/rh/temps/feries">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des jours fériés…" />}>
      <PublicHolidaysContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PublicHolidaysContent({
  searchParams,
}: Pick<PageProps<"/rh/temps/feries">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  // HR-010 — un jour férié retire du travail attendu : son écriture est du paramétrage, donc la gestion.
  const canManage = await canAccessModule(session, "hr", "manage");
  const today = todayIsoDate();
  const query = await searchParams;
  const yearFilter = Number(first(query.annee)) || Number(today.slice(0, 4));
  const [memberships, years, holidays] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    holidayYears(db, session.tenantId),
    listPublicHolidays(db, session.tenantId, { year: yearFilter }),
  ]);

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const removed = typeof query.supprime === "string";
  const thisYear = Number(today.slice(0, 4));
  const yearOptions = [...new Set([thisYear, ...years, yearFilter])].sort((a, b) => b - a);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Temps de travail
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Jours fériés et chômés</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Un férié ou un jour chômé retire une demi-journée — ou la journée — du travail attendu
              par le calendrier. La saisie, la modification et la suppression demandent le niveau
              gestion ; la journée complète et une demi-journée ne cohabitent pas le même jour.
            </p>
          </div>
        </div>

        {created || updated || removed ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created
              ? "Jour férié ou chômé inscrit."
              : updated
                ? "Jour férié ou chômé mis à jour."
                : "Jour férié ou chômé supprimé."}
          </p>
        ) : null}

        {canManage ? (
          <details className="mt-5 rounded-xl border border-line bg-panel px-5 py-4" open={created}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-brand" aria-hidden="true" />
              Inscrire un jour
            </summary>
            <div className="mt-4">
              <PublicHolidayForm mode="create" today={today} />
            </div>
          </details>
        ) : null}

        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <Filter className="size-3.5 self-center text-muted" aria-hidden="true" />
          <label className="text-[10px] text-muted">
            Année
            <select name="annee" defaultValue={String(yearFilter)} className={CONTROL}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            aria-label="Filtrer les jours fériés"
            title="Filtrer les jours fériés"
            className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
          >
            <Filter className="size-4" aria-hidden="true" />
          </button>
          {yearFilter !== thisYear ? (
            <Link
              href="/rh/temps/feries"
              aria-label="Revenir à l'année courante"
              title="Revenir à l'année courante"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <X className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </form>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarOff className="size-4 text-brand" aria-hidden="true" />
              {yearFilter}
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {holidays.length} jour{holidays.length > 1 ? "s" : ""}
            </p>
          </div>
          {holidays.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarOff className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun jour férié ni chômé pour {yearFilter}. Le travail attendu suit alors le
                calendrier, sans retrait.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Jours fériés et chômés de {yearFilter}, du plus proche au plus lointain
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Nature
                    </th>
                    <th scope="col" className={TH}>
                      Portée
                    </th>
                    <th scope="col" className={TH}>
                      Libellé
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                    {canManage ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Supprimer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((holiday) => (
                    <tr key={holiday.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                        {isoDateLabel(holiday.workDate)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {kindLabel(holiday.kind)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {HR_DAY_PERIOD_LABELS[holiday.period as HrDayPeriod]}
                      </td>
                      <td className="px-4 py-2.5 break-words">{holiday.label}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/temps/feries/${holiday.id}`}
                          aria-label={`Ouvrir ${holiday.label}`}
                          title="Ouvrir le jour"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                      {canManage ? (
                        <td className="px-4 py-2.5 text-right">
                          <DeletePublicHolidayButton
                            holidayId={holiday.id}
                            label={`${holiday.label} · ${isoDateLabel(holiday.workDate)}`}
                          />
                        </td>
                      ) : null}
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
