import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Check, CircleDashed, Mail, ScrollText, Settings2, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { MODULE_ICONS } from "@/components/nav-items";
import { getDb } from "@/db/client";
import { getAccessLevels, requirePermission } from "@/lib/auth/session";
import { atLeast, MODULE_KEYS, moduleLabel } from "@/modules/identity/modules";
import { can } from "@/modules/identity/permissions";
import { ROLE_LABELS } from "@/modules/identity/labels";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { MODULE_SETTINGS, settingsCoverage, settingsHref } from "@/modules/settings/directory";
import { getCompanySettings } from "@/modules/settings/queries";
import { CompanyForm } from "./company-form";
import { LogoPanel } from "./logo-panel";

export const metadata: Metadata = {
  title: "Paramètres",
};

interface Banner {
  readonly tone: "success" | "warning";
  readonly text: string;
}

function bannerFor(query: Record<string, string | string[] | undefined>): Banner | null {
  if (typeof query.enregistre === "string") {
    return {
      tone: "success",
      text:
        query.enregistre === "cree"
          ? "Fiche entreprise créée pour cet espace de travail."
          : "Fiche entreprise mise à jour ; les changements sont audités.",
    };
  }
  if (query.logo === "maj") {
    return { tone: "success", text: "Logo mis à jour." };
  }
  if (query.logo === "supprime") {
    return { tone: "success", text: "Logo retiré ; l'initiale de l'entreprise est affichée." };
  }
  return null;
}

export default function SettingsPage(props: PageProps<"/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <SettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SettingsContent({ searchParams }: Pick<PageProps<"/parametres">, "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const db = getDb();
  const [settings, memberships, levels, query] = await Promise.all([
    getCompanySettings(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
    searchParams,
  ]);
  const editable = can(session.role, "settings.manage");
  const canReadAudit = can(session.role, "audit.read");
  const banner = bannerFor(query);
  const coverage = settingsCoverage();
  const visibleModules = MODULE_KEYS.filter((key) => atLeast(levels[key], "read"));

  const checkpoints = [
    { label: "Identité légale", done: Boolean(settings?.legalName && settings.countryCode) },
    { label: "Coordonnées", done: Boolean(settings?.addressLine && settings.city) },
    { label: "Logo", done: Boolean(settings?.logoMime) },
    { label: "Coordonnées bancaires", done: Boolean(settings?.bankAccountNumber) },
    { label: "Mentions de facture", done: Boolean(settings?.invoiceFooter) },
  ];
  const completed = checkpoints.filter((item) => item.done).length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="settings" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Socle · organisation
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-tight">Paramètres</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              L&apos;annuaire du paramétrage : chaque module ouvre son propre écran, à la manière
              d&apos;Odoo. La fiche entreprise fixe l&apos;identité, les coordonnées, le règlement,
              la banque et le logo, et alimente les documents et les modèles d&apos;échange sans
              jamais modifier un document déjà émis.
            </p>
          </div>
          <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
            {ROLE_LABELS[session.role]} · {session.tenantName}
          </span>
        </div>

        {banner ? (
          <p
            role="status"
            className={`mt-5 rounded-md border px-3 py-2 text-[11px] ${
              banner.tone === "success"
                ? "border-brand/20 bg-brand-soft text-brand-strong"
                : "border-copper/20 bg-copper-soft text-copper"
            }`}
          >
            {banner.text}
          </p>
        ) : null}

        {!editable ? (
          <p className="mt-5 rounded-md border border-line bg-panel px-3 py-2 text-[11px] leading-5 text-muted">
            Votre rôle permet de consulter la fiche, pas de la modifier. Demandez à un propriétaire
            ou à un administrateur pour toute mise à jour.
          </p>
        ) : null}

        <section aria-labelledby="modules-title" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
                Annuaire
              </p>
              <h2 id="modules-title" className="mt-1 text-lg font-medium tracking-tight">
                Paramétrage des modules
              </h2>
            </div>
            <p className="text-[11px] text-muted">
              {coverage.delivered}/{coverage.total} écrans livrés
            </p>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleModules.map((key) => {
              const Icon = MODULE_ICONS[key];
              const href = settingsHref(key);
              const label = moduleLabel(key);
              const body = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    {href ? (
                      <Settings2
                        className="size-4 text-muted transition-colors group-hover:text-brand"
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] text-muted">
                        À venir
                      </span>
                    )}
                  </span>
                  <span className="mt-3 block text-sm font-medium">{label}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-muted">
                    {MODULE_SETTINGS[key].summary}
                  </span>
                </>
              );

              return (
                <li key={key} className="flex">
                  {href ? (
                    <Link
                      href={href}
                      aria-label={`Paramètres · ${label}`}
                      title={`Paramètres · ${label}`}
                      className="group flex w-full flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-brand/30"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      aria-disabled="true"
                      className="flex w-full flex-col rounded-xl border border-dashed border-line bg-panel/60 p-4"
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <h2 className="mt-10 border-b border-line pb-4 text-sm font-semibold">Entreprise</h2>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <CompanyForm
            settings={settings}
            fallbackLegalName={session.tenantName}
            editable={editable}
          />

          <aside className="space-y-5">
            <LogoPanel
              hasLogo={Boolean(settings?.logoMime)}
              version={settings?.updatedAt.getTime() ?? 0}
              tenantName={settings?.legalName ?? session.tenantName}
              editable={editable}
            />

            <section className="rounded-xl border border-line bg-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Complétude</h2>
                <span className="font-mono text-[10px] text-muted">
                  {completed}/{checkpoints.length}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Complétude de la fiche entreprise"
                aria-valuemin={0}
                aria-valuemax={checkpoints.length}
                aria-valuenow={completed}
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${(completed / checkpoints.length) * 100}%` }}
                />
              </div>
              <ul className="mt-4 space-y-2">
                {checkpoints.map((item) => (
                  <li key={item.label} className="flex items-center gap-2 text-[11px]">
                    {item.done ? (
                      <Check className="size-3.5 text-brand" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="size-3.5 text-muted" aria-hidden="true" />
                    )}
                    <span className={item.done ? "text-ink" : "text-muted"}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="size-4 text-brand" aria-hidden="true" />
                Échanges fournisseurs
              </h2>
              <p className="mt-2 text-[10px] leading-4 text-muted">
                Compte SMTP chiffré, modèles de demande et de confirmation, journal des envois et
                pièces jointes PDF.
              </p>
              <Link
                href="/parametres/echanges"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline"
              >
                <Mail className="size-3.5" aria-hidden="true" />
                Configurer les échanges
              </Link>
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
                Accès
              </h2>
              <p className="mt-2 text-[10px] leading-4 text-muted">
                La fiche est lisible par tous les membres. Seuls le propriétaire et
                l&apos;administrateur la modifient, avec une trace d&apos;audit.
              </p>
              {canReadAudit ? (
                <Link
                  href="/audit"
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline"
                >
                  <ScrollText className="size-3.5" aria-hidden="true" />
                  Consulter le journal
                </Link>
              ) : null}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
