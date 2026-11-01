import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CalendarDays, Lock, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  DeleteWorkCalendarButton,
  SetDefaultCalendarButton,
  WorkCalendarForm,
  type CalendarDayValues,
  type CalendarValues,
} from "@/components/hr-time-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import type { HrCalendarDay } from "@/db/schema";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_WEEK_DAYS, HR_WEEK_DAY_LABELS } from "@/modules/hr/constants";
import { formatHalfDays, formatHours, workedHalfDays } from "@/modules/hr/time";
import { getWorkCalendar, type WorkCalendarDay } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Calendrier de travail",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const TH = "px-3 py-2 font-normal";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dayValues(values: readonly WorkCalendarDay[]): {
  [day in HrCalendarDay]: CalendarDayValues;
} {
  const days = {} as Record<HrCalendarDay, CalendarDayValues>;
  for (const weekDay of HR_WEEK_DAYS) {
    const day = values.find((item) => item.dayOfWeek === weekDay);
    days[weekDay] = {
      morningFrom: day?.morningFrom ?? "",
      morningTo: day?.morningTo ?? "",
      afternoonFrom: day?.afternoonFrom ?? "",
      afternoonTo: day?.afternoonTo ?? "",
      sequence: day?.sequence ?? HR_WEEK_DAYS.indexOf(weekDay) + 1,
    };
  }
  return days;
}

export default function WorkCalendarPage(props: PageProps<"/rh/temps/calendriers/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du calendrier…" />}>
      <WorkCalendarContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function WorkCalendarContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/temps/calendriers/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const canManage = await canAccessModule(session, "hr", "manage");
  const [calendar, memberships, query] = await Promise.all([
    getWorkCalendar(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!calendar) {
    notFound();
  }

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";

  const values: CalendarValues = {
    name: calendar.name,
    isDefault: calendar.isDefault,
    days: dayValues(calendar.days),
  };

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/temps/calendriers"
            aria-label="Revenir aux calendriers"
            title="Revenir aux calendriers"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Calendrier de travail
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {calendar.name}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {formatHalfDays(calendar.weeklyHalfDays)} demi-journée(s) ·{" "}
              {formatHours(calendar.weeklyHours)} h par semaine · {calendar.attachedEmployees}{" "}
              fiche(s)
            </p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-1.5">
              {calendar.isDefault ? null : (
                <SetDefaultCalendarButton calendarId={calendar.id} label={calendar.name} />
              )}
              <DeleteWorkCalendarButton calendarId={calendar.id} label={calendar.name} />
            </div>
          ) : null}
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Calendrier créé." : "Calendrier mis à jour."}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {calendar.isDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft px-2 py-0.5 text-[10px] whitespace-nowrap text-brand-strong">
              <Lock className="size-3" aria-hidden="true" />
              Calendrier de l&apos;espace
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] whitespace-nowrap text-muted">
              <ShieldAlert className="size-3" aria-hidden="true" />
              Calendrier d&apos;appoint
            </span>
          )}
        </div>

        <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4 text-brand" aria-hidden="true" />
              Semaine
            </h2>
            <p className="text-[10px] text-muted">
              La semaine commence {HR_WEEK_DAY_LABELS[calendar.firstDayOfWeek].toLowerCase()}.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Demi-journées attendues, jour par jour</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Rang
                  </th>
                  <th scope="col" className={TH}>
                    Jour
                  </th>
                  <th scope="col" className={TH}>
                    Matin
                  </th>
                  <th scope="col" className={TH}>
                    Après-midi
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Demi-journées
                  </th>
                </tr>
              </thead>
              <tbody>
                {HR_WEEK_DAYS.map((weekDay) => {
                  const day = calendar.days.find((item) => item.dayOfWeek === weekDay);
                  const morning = day?.morningFrom
                    ? `${day.morningFrom} — ${day.morningTo}`
                    : "non travaillée";
                  const afternoon = day?.afternoonFrom
                    ? `${day.afternoonFrom} — ${day.afternoonTo}`
                    : "non travaillée";
                  const halfDays = workedHalfDays({
                    morningFrom: day?.morningFrom ?? null,
                    morningTo: day?.morningTo ?? null,
                    afternoonFrom: day?.afternoonFrom ?? null,
                    afternoonTo: day?.afternoonTo ?? null,
                  });
                  return (
                    <tr key={weekDay} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 font-mono text-[10px] tabular-nums">
                        {day?.sequence ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium">{HR_WEEK_DAY_LABELS[weekDay]}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{morning}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{afternoon}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {halfDays === 0 ? "repos" : formatHalfDays(halfDays)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {canManage ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Modifier le calendrier
            </summary>
            <div className="mt-4">
              <WorkCalendarForm mode="edit" calendarId={calendar.id} calendar={values} />
            </div>
          </details>
        ) : (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Lecture seule : créer, modifier, désigner le calendrier de l&apos;espace ou supprimer un
            calendrier demande le niveau gestion sur le module RH.
          </p>
        )}
      </main>
    </div>
  );
}
