import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Fingerprint } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { TimeEntryForm } from "@/components/hr-time-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { listEmployees } from "@/modules/hr/queries";
import { getPunchExpectation } from "@/modules/hr/time-queries";

export const metadata: Metadata = {
  title: "Nouveau pointage",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function NewTimeEntryPage(props: PageProps<"/rh/pointages/nouveau">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de la saisie du pointage…" />}>
      <NewTimeEntryContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function NewTimeEntryContent({
  searchParams,
}: Pick<PageProps<"/rh/pointages/nouveau">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "write");
  const db = getDb();
  const today = todayIsoDate();
  const query = await searchParams;

  const [employees, memberships] = await Promise.all([
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
  ]);

  // HR-011 — la fiche salarié qui appelle la ligue porte déjà son salarié et, parfois, son jour.
  const salarieParam = first(query.salarie);
  const presetEmployeeId =
    employees.find((employee) => employee.id === salarieParam && employee.status !== "left")?.id ??
    undefined;
  const dateParam = first(query.date);
  const presetDate = ISO_DATE_PATTERN.test(dateParam) && dateParam <= today ? dateParam : undefined;

  const expectation = await getPunchExpectation(db, session.tenantId, {
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
  });

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href={presetEmployeeId ? `/rh/personnel/${presetEmployeeId}` : "/rh/pointages"}
            aria-label={presetEmployeeId ? "Revenir à la fiche salarié" : "Revenir aux pointages"}
            title={presetEmployeeId ? "Revenir à la fiche salarié" : "Revenir aux pointages"}
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Pointages
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle ligue</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          La date se pré-remplit du jour choisi — aujourd&apos;hui par défaut — et le salarié est
          repris de la fiche qui ouvre l&apos;écran. Le panneau affiche, sous le calendrier
          applicable, les demi-journées attendues ce jour-là : une période fermée reste proposée
          mais refusée à l&apos;enregistrement.
        </p>

        <section className="mt-5 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <Fingerprint className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Ligue de pointage</h2>
          </div>
          <div className="mt-4">
            <TimeEntryForm
              mode="create"
              today={today}
              employees={employees
                .filter((employee) => employee.status !== "left")
                .map((employee) => ({
                  id: employee.id,
                  code: employee.code,
                  fullName: employee.fullName,
                }))}
              expectation={expectation}
              presetEmployeeId={presetEmployeeId}
              presetDate={presetDate}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
