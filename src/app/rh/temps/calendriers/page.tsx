import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CalendarDays, Plus, Star } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { formatHalfDays, formatHours } from "@/modules/hr/time";
import { listWorkCalendars } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Calendriers de travail",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function WorkCalendarsPage(props: PageProps<"/rh/temps/calendriers">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des calendriers…" />}>
      <WorkCalendarsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function WorkCalendarsContent({
  searchParams,
}: Pick<PageProps<"/rh/temps/calendriers">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  // HR-009 — le calendrier est du paramétrage : sa lecture reste ouverte au niveau lecture.
  const canManage = await canAccessModule(session, "hr", "manage");
  const [query, memberships, calendars] = await Promise.all([
    searchParams,
    listMembershipsForUser(db, session.userId),
    listWorkCalendars(db, session.tenantId),
  ]);

  const deleted = typeof query.supprime === "string";
  const attachedTotal = calendars.reduce(
    (total, calendar) => total + calendar.attachedEmployees,
    0,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Temps de travail
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Calendriers de travail</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Un calendrier décrit la semaine type : les bornes du matin et de l&apos;après-midi,
              jour par jour. Celui de l&apos;espace s&apos;applique aux fiches qui n&apos;ont pas de
              calendrier propre. Créer, modifier, désigner le calendrier de l&apos;espace ou
              supprimer relèvent de la gestion.
            </p>
          </div>
          {canManage ? (
            <Link
              href="/rh/temps/calendriers/nouveau"
              aria-label="Créer un calendrier"
              title="Créer un calendrier"
              className={ACTION_LINK}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {deleted ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            Calendrier supprimé.
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Calendriers</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{calendars.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Calendrier de l&apos;espace</dt>
            <dd className="mt-1 text-[12px]">
              {calendars.find((calendar) => calendar.isDefault)?.name ?? "Aucun"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Fiches rattachées</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{attachedTotal}</dd>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4 text-brand" aria-hidden="true" />
              Calendriers
            </h2>
            <p className="text-[10px] text-muted tabular-nums">
              {calendars.length} calendrier{calendars.length > 1 ? "s" : ""}
            </p>
          </div>
          {calendars.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <CalendarDays className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun calendrier. Tant que la semaine type n&apos;est pas écrite, aucune
                demi-journée n&apos;est attendue et aucun pointage ne peut être saisi.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">
                  Calendriers de travail de l&apos;espace, celui de l&apos;espace en tête
                </caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Nom
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Demi-journées
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Heures
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Fiches
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calendars.map((calendar) => (
                    <tr key={calendar.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="block font-medium break-words">{calendar.name}</span>
                          {calendar.isDefault ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft px-2 py-0.5 text-[10px] whitespace-nowrap text-brand-strong">
                              <Star className="size-3" aria-hidden="true" />
                              Espace
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatHalfDays(calendar.weeklyHalfDays)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatHours(calendar.weeklyHours)} h
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {calendar.attachedEmployees}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/temps/calendriers/${calendar.id}`}
                          aria-label={`Ouvrir le calendrier ${calendar.name}`}
                          title="Ouvrir le calendrier"
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

        <p className="mt-3 text-[10px] leading-4 text-muted">
          Rattachez un calendrier à une fiche salarié depuis Personnel ; à défaut, la fiche suit le
          calendrier de l&apos;espace.
        </p>
      </main>
    </div>
  );
}
