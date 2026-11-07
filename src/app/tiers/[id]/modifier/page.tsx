import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { categoriesByPartner, listPartnerCategories } from "@/modules/catalog/partner-queries";
import { getPartnerBankAccount } from "@/modules/catalog/partner-bank-account-queries";
import { getPartner } from "@/modules/catalog/queries";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { PartnerEditForm } from "./partner-edit-form";
import { PartnerBankForm } from "./partner-bank-form";

export const metadata: Metadata = {
  title: "Modifier un tiers",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PartnerEditPage(props: PageProps<"/tiers/[id]/modifier">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du formulaire…" />}>
      <PartnerEditContent params={props.params} />
    </Suspense>
  );
}

async function PartnerEditContent({ params }: Pick<PageProps<"/tiers/[id]/modifier">, "params">) {
  await connection();
  const session = await requireModule("partners", "read");
  const { id: partnerId } = await params;
  if (!UUID_PATTERN.test(partnerId)) {
    notFound();
  }

  const db = getDb();
  const [partner, categories, titles, memberships, levels] = await Promise.all([
    getPartner(db, { tenantId: session.tenantId, partnerId }),
    listPartnerCategories(db, session.tenantId),
    categoriesByPartner(db, session.tenantId, [partnerId]),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);

  if (!partner) {
    notFound();
  }

  const canManageBankDetails =
    atLeast(levels.purchases, "manage") || atLeast(levels.accounting, "manage");
  const canEditPartner = atLeast(levels.partners, "write");
  const bankAccount =
    partner.isSupplier && canManageBankDetails
      ? await getPartnerBankAccount(db, { tenantId: session.tenantId, partnerId })
      : null;

  const selected = (titles.get(partner.id) ?? []).map((category) => category.id);
  const options = categories
    .filter((category) => category.active || selected.includes(category.id))
    .map((category) => ({ id: category.id, label: category.title }));

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href={`/tiers/${partner.id}`}
            aria-label="Revenir à la fiche"
            title="Revenir à la fiche"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              {partner.code}
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Modifier le tiers</h1>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">
          Chaque modification remplace la valeur précédente et laisse une trace d&apos;audit. Le
          code de la fiche reste immuable.
        </p>

        {canEditPartner ? (
          <PartnerEditForm
            partner={{
              id: partner.id,
              code: partner.code,
              name: partner.name,
              isCompany: partner.type === "company",
              isCustomer: partner.isCustomer,
              isSupplier: partner.isSupplier,
              email: partner.email,
              phone: partner.phone,
              addressLine: partner.addressLine,
              city: partner.city,
              countryCode: partner.countryCode,
              taxNumber: partner.taxNumber,
              paymentTermDays: partner.paymentTermDays,
              latitude: partner.latitude,
              longitude: partner.longitude,
              active: partner.active,
            }}
            categories={options}
            selected={selected}
            canCreateCategories={atLeast(levels.partners, "manage")}
          />
        ) : null}
        {partner.isSupplier && canManageBankDetails ? (
          <PartnerBankForm partnerId={partner.id} account={bankAccount} />
        ) : null}
        {!canEditPartner && !canManageBankDetails ? (
          <p className="mt-6 rounded-lg border border-line p-4 text-sm text-muted">
            Votre accès permet de consulter cette fiche, sans modifier ses informations ni ses
            coordonnées bancaires.
          </p>
        ) : null}
      </main>
    </div>
  );
}
