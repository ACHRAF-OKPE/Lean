import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DeclarationHeaderForm } from "@/components/customs-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { getDeclarationOptions } from "@/modules/customs/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Nouvelle déclaration",
};

export default function NewDeclarationPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <NewDeclarationContent />
    </Suspense>
  );
}

async function NewDeclarationContent() {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [options, memberships] = await Promise.all([
    getDeclarationOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const missing: string[] = [];
  if (options.regimes.length === 0) {
    missing.push("un régime actif");
  }
  if (options.offices.length === 0) {
    missing.push("un bureau actif");
  }
  if (options.partners.length === 0) {
    missing.push("un tiers actif");
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/douane"
            aria-label="Revenir à la douane"
            title="Revenir à la douane"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Douane</p>
            <h1 className="text-2xl font-medium tracking-tight">Nouvelle déclaration</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le brouillon reçoit son numéro DEC à la création. Ajoutez ensuite les lignes à la main ou
          par import XLSX, puis déposez la déclaration pour la liquider.
        </p>

        {missing.length > 0 ? (
          <div className="mt-6 flex gap-2 rounded-lg border border-copper/20 bg-copper-soft px-4 py-3 text-[11px] leading-5 text-copper">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Référentiel douanier incomplet.</p>
              <p className="mt-0.5">
                Une déclaration exige {missing.join(", ")}.{" "}
                <Link href="/douane/referentiels" className="underline underline-offset-2">
                  Compléter les référentiels
                </Link>
                {options.partners.length === 0 ? (
                  <>
                    {" "}
                    ou{" "}
                    <Link href="/tiers/nouveau" className="underline underline-offset-2">
                      créer un tiers
                    </Link>
                  </>
                ) : null}
                .
              </p>
            </div>
          </div>
        ) : (
          <DeclarationHeaderForm options={options} today={todayIsoDate()} />
        )}
      </main>
    </div>
  );
}
