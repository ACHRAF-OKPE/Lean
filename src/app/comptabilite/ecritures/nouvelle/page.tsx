import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CircleAlert, NotebookPen } from "lucide-react";
import { EntryForm } from "@/components/accounting-forms";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { todayIsoDate } from "@/lib/dates";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listAccounts, listJournals, listOpenFiscalYears } from "@/modules/accounting/queries";
import { listPartners } from "@/modules/catalog/queries";

export const metadata: Metadata = {
  title: "Saisir une écriture",
};

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export default function NewJournalEntryPage() {
  return (
    <Suspense fallback={<LoadingShell label="Préparation de la saisie…" />}>
      <NewJournalEntryContent />
    </Suspense>
  );
}

async function NewJournalEntryContent() {
  await connection();
  const session = await requirePermission("data.write");
  const db = getDb();
  const [years, journals, accounts, partners, memberships] = await Promise.all([
    listOpenFiscalYears(db, session.tenantId),
    listJournals(db, { tenantId: session.tenantId }),
    listAccounts(db, { tenantId: session.tenantId, activeOnly: true }),
    listPartners(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  const activeJournals = journals.filter((journal) => journal.active);
  const missing = [
    years.length === 0 ? { label: "Aucun exercice ouvert", href: "/comptabilite/exercices" } : null,
    activeJournals.length === 0
      ? { label: "Aucun journal actif", href: "/comptabilite/journaux" }
      : null,
    accounts.length === 0 ? { label: "Aucun compte actif", href: "/comptabilite/comptes" } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="accounting" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/comptabilite/ecritures"
            aria-label="Revenir aux écritures"
            title="Revenir aux écritures"
            className={ACTION_LINK}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Comptabilité
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Saisir une écriture</h1>
          </div>
        </div>

        {missing.length > 0 ? (
          <div className="mt-5 rounded-xl border border-copper/20 bg-copper-soft p-5">
            <p className="flex items-center gap-2 text-[11px] font-medium text-copper">
              <CircleAlert className="size-3.5" aria-hidden="true" />
              La saisie est bloquée tant que le socle comptable est incomplet.
            </p>
            <ul className="mt-2 space-y-1 text-[11px] leading-5 text-copper">
              {missing.map((item) => (
                <li key={item.href}>
                  {item.label} —{" "}
                  <Link href={item.href} className="underline">
                    corriger
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EntryForm
            today={todayIsoDate()}
            options={{
              journals: activeJournals.map((journal) => ({
                id: journal.id,
                code: journal.code,
                label: journal.label,
              })),
              accounts: accounts.map((account) => ({
                id: account.id,
                code: account.code,
                label: account.label,
              })),
              partners: partners.rows
                .filter((partner) => partner.active)
                .map((partner) => ({
                  id: partner.id,
                  code: partner.code,
                  name: partner.name,
                })),
            }}
          />
        )}

        {missing.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-[10px] text-muted">
            <NotebookPen className="size-3.5" aria-hidden="true" />
            L&apos;écriture reçoit son numéro à la création et reste modifiable uniquement via sa
            suppression tant qu&apos;elle est en brouillon.
          </p>
        ) : null}
      </main>
    </div>
  );
}
