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
import { getPartnerContact } from "@/modules/settings/contacts";

export const metadata: Metadata = {
  title: "Modifier le contact",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditContactPage(props: PageProps<"/tiers/[id]/contacts/[contactId]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du contact…" />}>
      <EditContactContent params={props.params} />
    </Suspense>
  );
}

async function EditContactContent({
  params,
}: Pick<PageProps<"/tiers/[id]/contacts/[contactId]">, "params">) {
  await connection();
  const session = await requirePermission("data.write");
  const { id: partnerId, contactId } = await params;
  if (!UUID_PATTERN.test(partnerId) || !UUID_PATTERN.test(contactId)) {
    notFound();
  }

  const db = getDb();
  const [partner, contact, memberships] = await Promise.all([
    getPartner(db, { tenantId: session.tenantId, partnerId }),
    getPartnerContact(db, { tenantId: session.tenantId, partnerId, contactId }),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!partner || !contact) {
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
          <h1 className="mt-2 text-2xl font-medium tracking-tight">{contact.fullName}</h1>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Le contact n&apos;est jamais supprimé : désactivez-le pour préserver l&apos;historique
            des échanges.
          </p>
        </div>

        <PartnerContactForm
          partnerId={partner.id}
          contact={{
            id: contact.id,
            fullName: contact.fullName,
            jobTitle: contact.jobTitle,
            email: contact.email,
            phone: contact.phone,
            isPrimary: contact.isPrimary,
            active: contact.active,
          }}
        />
      </main>
    </div>
  );
}
