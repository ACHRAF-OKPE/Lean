import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CalendarOff } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { PublicHolidayForm } from "@/components/hr-time-forms";
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
import { getPublicHoliday } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Jour férié ou chômé",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PublicHolidayPage(props: PageProps<"/rh/temps/feries/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du jour…" />}>
      <PublicHolidayContent params={props.params} />
    </Suspense>
  );
}

async function PublicHolidayContent({
  params,
}: Pick<PageProps<"/rh/temps/feries/[id]">, "params">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const canManage = await canAccessModule(session, "hr", "manage");
  const [holiday, memberships] = await Promise.all([
    getPublicHoliday(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!holiday) {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/temps/feries"
            aria-label="Revenir aux jours fériés"
            title="Revenir aux jours fériés"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Jour férié ou chômé
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {holiday.label}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {isoDateLabel(holiday.workDate)} ·{" "}
              {isHrHolidayKind(holiday.kind) ? HR_HOLIDAY_KIND_LABELS[holiday.kind] : holiday.kind}{" "}
              · {HR_DAY_PERIOD_LABELS[holiday.period as HrDayPeriod]}
            </p>
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-muted">
          Ce jour retire {HR_DAY_PERIOD_LABELS[holiday.period as HrDayPeriod].toLowerCase()} du
          travail attendu par les calendriers : les pointages refusés sur cette portée le renvoient
          déjà à la lecture. La portée « Journée » exclut toute autre inscription le même jour.
        </p>

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <CalendarOff className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Modifier l&apos;inscription</h2>
            </div>
            <div className="mt-4">
              <PublicHolidayForm
                mode="edit"
                holidayId={holiday.id}
                today={todayIsoDate()}
                holiday={{
                  workDate: holiday.workDate,
                  kind: holiday.kind,
                  period: holiday.period,
                  label: holiday.label,
                }}
              />
            </div>
          </section>
        ) : (
          <p className="mt-5 text-[10px] leading-4 text-muted">
            Lecture seule : inscrire, modifier ou supprimer un jour férié ou chômé demande le niveau
            gestion sur le module RH.
          </p>
        )}
      </main>
    </div>
  );
}
