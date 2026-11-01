import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, CalendarDays, CalendarOff, Clock, Fingerprint } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { formatHalfDays, formatHours } from "@/modules/hr/time";
import {
  getTimeEntryCounters,
  listPublicHolidays,
  listWorkCalendars,
} from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Temps de travail",
};

const CARD =
  "flex items-start gap-3 rounded-xl border border-line bg-panel px-5 py-4 transition-colors hover:border-brand/30";

const SECTIONS = [
  {
    href: "/rh/temps/calendriers",
    title: "Calendriers de travail",
    icon: CalendarDays,
    text: "La semaine type de l'espace et ses variantes : bornes du matin et de l'après-midi, jour par jour.",
  },
  {
    href: "/rh/temps/feries",
    title: "Jours fériés et chômés",
    icon: CalendarOff,
    text: "Les jours retirés du travail attendu, sur la journée ou sur une seule demi-journée.",
  },
  {
    href: "/rh/pointages",
    title: "Pointages",
    icon: Fingerprint,
    text: "Les lignes d'absence et de temps travaillé, saisies en brouillon puis validées en gestion.",
  },
] as const;

export default function WorkTimePage() {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du temps de travail…" />}>
      <WorkTimeContent />
    </Suspense>
  );
}

async function WorkTimeContent() {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const today = todayIsoDate();
  const [calendars, holidays, counters, memberships, canWrite] = await Promise.all([
    listWorkCalendars(db, session.tenantId),
    listPublicHolidays(db, session.tenantId, { year: Number(today.slice(0, 4)) }),
    getTimeEntryCounters(db, session.tenantId, today),
    listMembershipsForUser(db, session.userId),
    canAccessModule(session, "hr", "write"),
  ]);

  const defaultCalendar = calendars.find((calendar) => calendar.isDefault);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Ressources humaines
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Temps de travail</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Le calendrier dû, les jours fériés retirés, puis les pointages qui constatent le
              travail ou l&apos;absence. Un pointage ne se saisit que sur une demi-journée attendue
              par le calendrier applicable au salarié, et jamais pour un jour futur.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Calendriers</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{calendars.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Fériés et chômés cette année</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{holidays.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Pointages en brouillon</dt>
            <dd
              className={`mt-1 font-mono text-2xl tabular-nums ${
                counters.drafts > 0 ? "text-copper" : ""
              }`}
            >
              {counters.drafts}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Demi-journées travaillées ce mois</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">
              {formatHalfDays(counters.workedHalfDaysThisMonth)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[10px] leading-4 text-muted tabular-nums">
          {counters.validatedThisMonth} pointage(s) validé(s) et {counters.absencesThisMonth}{" "}
          absence(s) ce mois, {formatHours(counters.workedHoursThisMonth)} h cumulées,{" "}
          {counters.employeesPunchedThisMonth} salarié(s) pointé(s). Le calendrier de l&apos;espace
          est{" "}
          {defaultCalendar
            ? `« ${defaultCalendar.name} » : ${formatHalfDays(defaultCalendar.weeklyHalfDays)} demi-journée(s) et ${formatHours(defaultCalendar.weeklyHours)} h par semaine.`
            : "absent — sans lui, les fiches sans calendrier propre ne peuvent être pointées."}
        </p>

        <div className="mt-5 grid gap-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link key={section.href} href={section.href} className={CARD}>
                <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{section.title}</span>
                  <span className="mt-1 block text-[11px] leading-5 text-muted">
                    {section.text}
                  </span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Clock className="size-3.5 text-muted" aria-hidden="true" />
          <p className="text-[10px] leading-4 text-muted">
            Les heures se comptent au quart d&apos;heure, les demi-journées à la demi-journée, à
            l&apos;heure d&apos;Abidjan. Le paramétrage des calendriers et des jours fériés, la
            validation d&apos;un pointage et son retour au brouillon relèvent de la gestion ; la
            saisie demande le niveau écriture{canWrite ? "" : " — non accordé à votre compte"}.
          </p>
        </div>
      </main>
    </div>
  );
}
