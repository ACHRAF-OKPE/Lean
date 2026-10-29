import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert, ClipboardList, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { addIsoDays } from "@/modules/supply/calculation";
import { getSupplyRun } from "@/modules/supply/queries";
import { ProposalWorkbench } from "./workbench";

export const metadata: Metadata = {
  title: "Calcul des besoins",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Abidjan",
});

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function bannersFor(query: Record<string, string | string[] | undefined>): Banner[] {
  const banners: Banner[] = [];
  const calcule = single(query.calcule);
  if (calcule) {
    banners.push({
      tone: "success",
      text: `Calcul ${calcule} enregistré : sélectionnez les propositions à convertir.`,
    });
  }
  const commandes = Number.parseInt(single(query.commandes) ?? "", 10);
  if (Number.isFinite(commandes) && commandes > 0) {
    banners.push({
      tone: "success",
      text: `${commandes} commande(s) brouillon créée(s) : confirmez-les depuis les achats pour obtenir le numéro CMD.`,
    });
  }
  if (single(query.ecartee)) {
    banners.push({
      tone: "success",
      text: "Proposition écartée. Le motif reste consultable dans le journal d'audit.",
    });
  }
  return banners;
}

export default function SupplyRunDetailPage(props: PageProps<"/achats/besoins/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du calcul des besoins…" />}>
      <SupplyRunDetailContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SupplyRunDetailContent({
  params,
  searchParams,
}: Pick<PageProps<"/achats/besoins/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }
  const query = await searchParams;
  const db = getDb();
  const [detail, memberships] = await Promise.all([
    getSupplyRun(db, session.tenantId, id),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!detail) {
    notFound();
  }
  const canWrite = can(session.role, "data.write");
  const banners = bannersFor(query);
  const today = todayIsoDate();
  const { run, lines } = detail;
  const late = lines.filter((line) => line.late && line.decision === "pending").length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="supply" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/achats/besoins"
                aria-label="Revenir aux calculs des besoins"
                title="Calculs des besoins"
                className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
              </Link>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                {run.number}
              </p>
            </div>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Calcul des besoins</h1>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Lancé le {TIMESTAMP.format(run.calculatedAt)}
              {run.calculatedByName ? ` par ${run.calculatedByName}` : ""} sur un horizon de{" "}
              {run.horizonDays} jours. Le calcul est figé : un nouveau calcul crée un nouveau
              numéro.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-panel px-3 py-2">
              <dt className="text-[10px] text-muted">Articles</dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums">{run.lineCount}</dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-3 py-2">
              <dt className="text-[10px] text-muted">Propositions</dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums">{run.proposalCount}</dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-3 py-2">
              <dt className="text-[10px] text-muted">En attente</dt>
              <dd className="mt-0.5 font-mono text-lg text-copper tabular-nums">
                {run.pendingCount}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-3 py-2">
              <dt className="text-[10px] text-muted">En retard</dt>
              <dd className="mt-0.5 font-mono text-lg text-copper tabular-nums">{late}</dd>
            </div>
          </dl>
        </div>

        {banners.map((banner) => (
          <p
            key={banner.text}
            role="status"
            className={`mt-5 flex gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-5 ${
              banner.tone === "success"
                ? "border-brand/20 bg-brand-soft text-brand-strong"
                : "border-copper/20 bg-copper-soft text-copper"
            }`}
          >
            {banner.tone === "success" ? (
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{banner.text}</span>
          </p>
        ))}

        <div className="mt-5 flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2.5 text-[10px] leading-4 text-muted">
          <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <p>
            Chaque proposition retient le premier jour où le stock projeté perce le seuil. La date
            de commande recule du délai d&apos;approvisionnement et du délai de sécurité ; si elle
            tombe avant aujourd&apos;hui, la proposition est signalée en retard. Une proposition
            traitée ne peut plus être convertie.
          </p>
        </div>

        <div className="mt-5">
          <ProposalWorkbench
            runId={run.id}
            lines={lines}
            canWrite={canWrite}
            today={today}
            defaultDeadline={addIsoDays(today, 7)}
          />
        </div>
      </main>
    </div>
  );
}
