import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Mail, Pencil, Phone, UserPlus } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DiscussionPanel } from "@/components/discussion-panel";
import { DocumentTasks } from "@/components/document-tasks";
import { LoadingShell } from "@/components/loading-shell";
import { PartnerDeleteButton } from "@/components/views/partner-delete-button";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { categoriesByPartner } from "@/modules/catalog/partner-queries";
import { getPartnerBankAccount } from "@/modules/catalog/partner-bank-account-queries";
import { getPartner } from "@/modules/catalog/queries";
import { PARTNER_TYPE_LABELS } from "@/modules/catalog/constants";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listPartnerContacts } from "@/modules/settings/contacts";

export const metadata: Metadata = {
  title: "Fiche tiers",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = "px-4 py-2.5 font-normal";
const ICON_LINK =
  "grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

interface Banner {
  readonly text: string;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (query.contact === "cree") {
    return { text: "Contact créé." };
  }
  if (query.contact === "maj") {
    return { text: "Contact mis à jour ; le changement est audité." };
  }
  if (query.maj === "ok") {
    return { text: "Fiche mise à jour ; le changement est audité." };
  }
  return null;
}

export default function PartnerPage(props: PageProps<"/tiers/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement du tiers…" />}>
      <PartnerContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PartnerContent({
  params,
  searchParams,
}: Pick<PageProps<"/tiers/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requireModule("partners", "read");
  const { id: partnerId } = await params;
  if (!UUID_PATTERN.test(partnerId)) {
    notFound();
  }

  const db = getDb();
  const [partner, contacts, memberships, levels, query] = await Promise.all([
    getPartner(db, { tenantId: session.tenantId, partnerId }),
    listPartnerContacts(db, { tenantId: session.tenantId, partnerId }),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    searchParams,
  ]);

  if (!partner) {
    notFound();
  }

  const bankAccount = partner.isSupplier
    ? await getPartnerBankAccount(db, { tenantId: session.tenantId, partnerId })
    : null;

  const categories = (await categoriesByPartner(db, session.tenantId, [partner.id])).get(
    partner.id,
  );
  const level = levels.partners;
  const canWrite = atLeast(level, "write");
  const canManage = atLeast(level, "manage");
  const banner = bannerFor(query);
  const location = [partner.city, partner.countryCode].filter(Boolean).join(" · ") || "—";
  const coordinates =
    partner.latitude === null || partner.longitude === null
      ? null
      : `${partner.latitude.toFixed(5)} / ${partner.longitude.toFixed(5)}`;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="partners" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <Link
          href="/tiers"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Tous les tiers
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              {partner.code}
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">{partner.name}</h1>
            <p className="mt-1 text-[11px] text-muted">
              {PARTNER_TYPE_LABELS[partner.type]} ·{" "}
              {[partner.isCustomer ? "Client" : null, partner.isSupplier ? "Fournisseur" : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] ${
                partner.active
                  ? "border-brand/15 bg-brand-soft text-brand-strong"
                  : "border-copper/15 bg-copper-soft text-copper"
              }`}
            >
              {partner.active ? "Actif" : "Inactif"}
            </span>
            {canWrite ? (
              <Link
                href={`/tiers/${partner.id}/modifier`}
                aria-label="Modifier le tiers"
                title="Modifier le tiers"
                className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
            {canManage ? (
              <PartnerDeleteButton
                partnerId={partner.id}
                partnerName={partner.name}
                retour="/tiers"
              />
            ) : null}
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className="mt-5 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            {banner.text}
          </p>
        ) : null}

        <section
          aria-label="Informations du tiers"
          className="mt-6 grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Adresse</p>
            <p className="mt-1 text-[11px] leading-5">
              {partner.addressLine ?? "—"}
              {partner.city ? (
                <>
                  <br />
                  {partner.city}
                </>
              ) : null}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Localisation
            </p>
            <p className="mt-1 text-[11px] leading-5">{location}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted tabular-nums">
              {coordinates ?? "Sans coordonnées : absente de la carte."}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Catégories
            </p>
            {categories && categories.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {categories.map((category) => (
                  <span
                    key={category.id}
                    className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-muted"
                  >
                    {category.title}
                  </span>
                ))}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted">—</p>
            )}
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Délai de paiement
            </p>
            <p className="mt-1 text-[11px] tabular-nums">{partner.paymentTermDays} jours</p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">E-mail</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px]">
              <Mail className="size-3 text-muted" aria-hidden="true" />
              {partner.email ?? "—"}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Téléphone</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px]">
              <Phone className="size-3 text-muted" aria-hidden="true" />
              {partner.phone ?? "—"}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              Numéro fiscal
            </p>
            <p className="mt-1 font-mono text-[11px]">{partner.taxNumber ?? "—"}</p>
          </div>
        </section>

        {partner.isSupplier ? (
          <section
            aria-label="Coordonnées de règlement fournisseur"
            className="mt-6 grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div>
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                Compte bancaire
              </p>
              <p className="mt-1 text-[11px]">
                {bankAccount ? "Enregistré" : "Aucun compte bancaire enregistré."}
              </p>
              {bankAccount ? (
                <div className="mt-3 space-y-2 text-[11px]">
                  {bankAccount.bankName ? (
                    <p>
                      <span className="font-mono text-[10px] text-muted">Banque</span>{" "}
                      {bankAccount.bankName}
                    </p>
                  ) : null}
                  {bankAccount.accountHolder ? (
                    <p>
                      <span className="font-mono text-[10px] text-muted">Titulaire</span>{" "}
                      {bankAccount.accountHolder}
                    </p>
                  ) : null}
                  {bankAccount.iban ? (
                    <p className="font-mono">
                      <span className="text-muted">IBAN</span> {bankAccount.iban}
                    </p>
                  ) : null}
                  {bankAccount.bic ? (
                    <p className="font-mono">
                      <span className="text-muted">BIC / SWIFT</span> {bankAccount.bic}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-2 text-[10px] text-muted">
                Ces coordonnées sont figées sur chaque bon de commande émis à ce fournisseur.
              </p>
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
                Carnet de contacts
              </p>
              <h2 className="mt-1 text-sm font-semibold">
                {contacts.length} contact{contacts.length > 1 ? "s" : ""}
              </h2>
            </div>
            {canWrite ? (
              <Link
                href={`/tiers/${partner.id}/contacts/nouveau`}
                aria-label="Ajouter un contact"
                title="Ajouter un contact"
                className="grid size-8 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90"
              >
                <UserPlus className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
            {contacts.length === 0 ? (
              <p className="px-5 py-10 text-center text-[11px] leading-5 text-muted">
                Aucun contact pour ce tiers. Ajoutez le premier interlocuteur pour préparer les
                échanges.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <caption className="sr-only">Contacts du tiers</caption>
                  <thead>
                    <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                      <th scope="col" className={TH}>
                        Nom
                      </th>
                      <th scope="col" className={TH}>
                        Fonction
                      </th>
                      <th scope="col" className={TH}>
                        Coordonnées
                      </th>
                      <th scope="col" className={TH}>
                        Statut
                      </th>
                      <th scope="col" className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contact) => (
                      <tr key={contact.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5 font-medium">
                          <span className="flex flex-wrap items-center gap-2">
                            {contact.fullName}
                            {contact.isPrimary ? (
                              <span className="rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 text-[9px] text-brand-strong">
                                Principal
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{contact.jobTitle ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted">
                          <span className="block">{contact.email ?? "—"}</span>
                          <span className="block tabular-nums">{contact.phone ?? "—"}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              contact.active
                                ? "border-line bg-canvas text-muted"
                                : "border-copper/15 bg-copper-soft text-copper"
                            }`}
                          >
                            {contact.active ? "Actif" : "Inactif"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {canWrite ? (
                            <Link
                              href={`/tiers/${partner.id}/contacts/${contact.id}`}
                              aria-label={`Modifier le contact ${contact.fullName}`}
                              title="Modifier le contact"
                              className={ICON_LINK}
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <DocumentTasks
          session={session}
          entityType="partner"
          entityId={partner.id}
          label={`${partner.name} (${partner.code})`}
        />
        <DiscussionPanel session={session} entityType="partner" entityId={partner.id} />
      </main>
    </div>
  );
}
