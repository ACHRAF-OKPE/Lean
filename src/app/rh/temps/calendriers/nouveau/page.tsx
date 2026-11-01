import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { WorkCalendarForm } from "@/components/hr-time-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Nouveau calendrier de travail",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewWorkCalendarPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la saisie du calendrier…" />}>
      <NewWorkCalendarContent />
    </Suspense>
  );
}

async function NewWorkCalendarContent() {
  await connection();
  // HR-009 — le calendrier est du paramétrage : la saisie demande la gestion.
  const session = await requireModule("hr", "manage");
  const db = getDb();
  const memberships = await listMembershipsForUser(db, session.userId);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/rh/temps/calendriers"
            aria-label="Revenir aux calendriers"
            title="Revenir aux calendriers"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Calendriers de travail
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouveau calendrier</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Une demi-journée n&apos;est travaillée que si ses deux bornes sont écrites, dans
          l&apos;ordre et sans se chevaucher. Les jours sans bornes ne doivent rien au travail : un
          pointage y sera refusé. Le rang fixe l&apos;ordre d&apos;affichage de la semaine.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Semaine type</h2>
          </div>
          <div className="mt-4">
            <WorkCalendarForm mode="create" />
          </div>
        </section>
      </main>
    </div>
  );
}
