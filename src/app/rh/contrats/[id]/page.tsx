import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Lock, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ContractStatusBadge } from "@/components/hr-badges";
import {
  ContractForm,
  DeleteContractButton,
  StartContractButton,
  TerminateContractForm,
} from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { HR_LIST_LIMIT } from "@/modules/hr/constants";
import { getContract, listEmployees } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Contrat de travail",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ContractPage(props: PageProps<"/rh/contrats/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du contrat…" />}>
      <ContractContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ContractContent({
  params,
  searchParams,
}: Pick<PageProps<"/rh/contrats/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const db = getDb();
  const canWrite = await canAccessModule(session, "hr", "write");
  const canManage = await canAccessModule(session, "hr", "manage");
  const [contract, employees, memberships, query] = await Promise.all([
    // HR-005 — le salaire brut ne se lit qu'à partir du niveau écriture.
    getContract(db, { tenantId: session.tenantId, contractId: id, showSalary: canWrite }),
    listEmployees(db, { tenantId: session.tenantId, limit: HR_LIST_LIMIT }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!contract) {
    notFound();
  }

  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const draft = contract.status === "draft";
  const locked = !draft;
  const label = `${contract.kindLabel} · ${contract.employeeCode}`;
  const today = todayIsoDate();

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/rh/contrats"
            aria-label="Revenir aux contrats"
            title="Revenir aux contrats"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Contrat de travail
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight break-words">
              {contract.employeeName}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {contract.employeeCode} · {contract.kindLabel}
            </p>
          </div>
          {canManage && draft ? (
            <div className="flex items-center gap-1.5">
              <StartContractButton contractId={contract.id} label={label} />
              <DeleteContractButton contractId={contract.id} label={label} />
            </div>
          ) : null}
        </div>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Contrat créé en brouillon." : "Contrat mis à jour."}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ContractStatusBadge status={contract.displayStatus} />
          {locked ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <Lock className="size-3" aria-hidden="true" />
              Contrat sorti du brouillon : ses caractères sont figés.
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <ShieldAlert className="size-3" aria-hidden="true" />
              Brouillon : la mise en cours demande le niveau gestion.
            </span>
          )}
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Début</dt>
            <dd className="mt-1 text-[12px] tabular-nums">{isoDateLabel(contract.startDate)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Fin</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {contract.endDate ? isoDateLabel(contract.endDate) : "Sans terme"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Durée hebdomadaire</dt>
            <dd className="mt-1 text-[12px] tabular-nums">{contract.weeklyHours} h</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Période d&apos;essai</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {contract.trialDeadline
                ? `${contract.trialPeriodDays} jours — jusqu'au ${isoDateLabel(contract.trialDeadline)}`
                : "Aucune"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Salaire brut</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {canWrite
                ? contract.salaryXof
                  ? formatXof(contract.salaryXof)
                  : "Non renseigné"
                : "Réservé au niveau écriture"}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Résiliation</dt>
            <dd className="mt-1 text-[12px] tabular-nums">
              {contract.terminatedOn ? isoDateLabel(contract.terminatedOn) : "—"}
            </dd>
          </div>
        </dl>

        <section className="mt-4 rounded-xl border border-line bg-panel px-5 py-4">
          <h2 className="text-[11px] font-semibold">Salarié</h2>
          <p className="mt-2 text-[12px]">
            <Link
              href={`/rh/personnel/${contract.employeeId}`}
              className="inline-flex items-center gap-1.5 underline decoration-line underline-offset-4 hover:decoration-brand"
            >
              {contract.employeeName} · {contract.employeeCode}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </p>
          <p className="mt-2 text-[10px] leading-4 text-muted">
            Un seul contrat en cours par salarié et par espace : tant que celui-ci n&apos;est pas
            résilié ou échu, un second ne peut pas sortir du brouillon.
          </p>
        </section>

        {contract.displayStatus === "expired" ? (
          <p className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper">
            Contrat échu par sa date de fin : l&apos;écran le dérive à la lecture, aucune écriture
            n&apos;est nécessaire. Créez un nouveau contrat pour poursuivre la relation.
          </p>
        ) : null}

        {canManage && contract.status === "running" ? (
          <section className="mt-4 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Résilier le contrat</h2>
            <div className="mt-3">
              <TerminateContractForm
                contractId={contract.id}
                label={label}
                startDate={contract.startDate}
                today={today}
              />
            </div>
          </section>
        ) : null}

        {canWrite ? (
          <details className="mt-4 rounded-xl border border-line bg-panel px-5 py-4" open={draft}>
            <summary className="cursor-pointer text-sm font-semibold">
              {draft ? "Modifier le brouillon" : "Caractéristiques du contrat"}
            </summary>
            <div className="mt-4">
              <ContractForm
                mode="edit"
                contractId={contract.id}
                locked={locked}
                employees={employees.map((employee) => ({
                  id: employee.id,
                  code: employee.code,
                  fullName: employee.fullName,
                }))}
                contract={{
                  employeeId: contract.employeeId,
                  kind: contract.kind,
                  startDate: contract.startDate,
                  endDate: contract.endDate,
                  trialPeriodDays: contract.trialPeriodDays,
                  weeklyHours: contract.weeklyHours,
                  salaryXof: contract.salaryXof ?? 0,
                }}
              />
            </div>
          </details>
        ) : (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Lecture seule : le niveau écriture sur le module RH est requis pour modifier un
            brouillon ; sortir un contrat du brouillon, le résilier ou supprimer un brouillon relève
            de la gestion.
          </p>
        )}
      </main>
    </div>
  );
}
