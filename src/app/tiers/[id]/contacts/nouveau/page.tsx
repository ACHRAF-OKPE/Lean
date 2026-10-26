import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { PartnerContactForm } from "@/components/partner-contact-form";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { getPartner } from "@/modules/catalog/queries";
import { listMembershipsForUser } from "@/modules/identity/queries";

export const metadata: Metadata = {
  title: "Nouveau contact",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NewContactPage(props: PageProps<"/tiers/[id]/contacts/nouveau">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du contact…" />}>
      <NewContactContent params={props.params} />
    </Suspense>
  );
}

async function NewContactContent({
  params,
}: Pick<PageProps<"/tiers/[id]/contacts/nouveau">, "params">) {
  await connection();
  const session = await requirePermission("data.write");
  const { id: partnerId } = await params;
  if (!UUID_PATTERN.test(partnerId)) {
    notFound();
  }

  const db = getDb();
  const [partner, memberships] = await Promise.all([
    getPartner(db, { tenantId: session.tenantId, partnerId }),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!partner) {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <Link
          href={`/tiers/${partner.id}`}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {partner.name}
        </Link>

        <div className="mt-4">
          <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
            Carnet de contacts
          </p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Nouveau contact</h1>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Un seul contact peut être principal. Le désigner retire ce statut au précédent.
          </p>
        </div>

        <PartnerContactForm partnerId={partner.id} contact={null} />
      </main>
    </div>
  );
}
