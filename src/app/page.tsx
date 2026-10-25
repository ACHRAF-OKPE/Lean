import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowUpRight,
  Barcode,
  Check,
  CircleDot,
  Database,
  Layers,
  Lock,
  Package,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { getDb } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { LOTS, type LotStatus } from "@/lib/lots";
import { ROLE_LABELS } from "@/modules/identity/labels";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getCatalogCounts } from "@/modules/catalog/queries";

const GATE = [
  { label: "Lint", command: "npm run lint" },
  { label: "Types", command: "npm run typecheck" },
  { label: "Tests", command: "npm run test" },
  { label: "Build", command: "npm run build" },
] as const;

const STACK = [
  { label: "Application", value: "Next.js 16 · App Router" },
  { label: "Données", value: "Neon Postgres · Drizzle" },
  { label: "Hébergement", value: "Vercel · runtime Node" },
  { label: "Interface", value: "Tailwind CSS 4 · français" },
] as const;

const STATUS_META = {
  done: {
    label: "Livré",
    icon: Check,
    badge: "border-brand/15 bg-brand-soft text-brand-strong",
  },
  next: {
    label: "Prochain",
    icon: CircleDot,
    badge: "border-copper/15 bg-copper-soft text-copper",
  },
  planned: {
    label: "Planifié",
    icon: Lock,
    badge: "border-line bg-canvas text-muted",
  },
} satisfies Record<LotStatus, { label: string; icon: typeof Check; badge: string }>;

export const metadata: Metadata = {
  title: "Poste de pilotage",
};

export default function Home() {
  return (
    <Suspense fallback={<CockpitFallback />}>
      <Cockpit />
    </Suspense>
  );
}

function CockpitFallback() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4 md:px-10">
          <div
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
          >
            L
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Lean</p>
            <p className="text-[11px] text-muted">Ouverture de l&apos;espace…</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
        <div className="h-8 w-72 animate-pulse rounded bg-line" />
        <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded bg-line/70" />
        <div className="mt-10 h-64 animate-pulse rounded-xl border border-line bg-panel" />
      </main>
    </div>
  );
}

async function Cockpit() {
  await connection();
  const session = await requireSession();
  const db = getDb();
  const [memberships, counts] = await Promise.all([
    listMembershipsForUser(db, session.userId),
    getCatalogCounts(db, session.tenantId),
  ]);
  const deliveredCount = LOTS.filter((lot) => lot.status === "done").length;
  const nextLot = LOTS.find((lot) => lot.status === "next");

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="home" />

      <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] lg:items-end">
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-brand uppercase">
              Lot 02 · livré
            </p>
            <h1 className="mt-5 max-w-2xl text-4xl leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-5xl md:text-[3.25rem]">
              Le référentiel prend forme.
              <span className="block">Chaque ligne est vérifiée.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
              Tiers, articles et nomenclature douanière vivent désormais dans l&apos;espace actif.
              Les fichiers XLSX réels sont analysés ligne à ligne, avec un modèle téléchargeable :
              aucune donnée n&apos;est écrite avant confirmation.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium">Dossier de livraison</p>
              <span className="rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 font-mono text-[10px] text-brand-strong">
                L02
              </span>
            </div>

            <dl className="mt-5 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Lot courant</dt>
                <dd className="text-right text-[11px] font-medium">
                  Référentiel tiers &amp; articles
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Rôle</dt>
                <dd className="text-right text-[11px] font-medium">{ROLE_LABELS[session.role]}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Tiers</dt>
                <dd className="text-right font-mono text-[11px] font-medium">{counts.partners}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Articles</dt>
                <dd className="text-right font-mono text-[11px] font-medium">{counts.articles}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Codes SH</dt>
                <dd className="text-right font-mono text-[11px] font-medium">{counts.hsCodes}</dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-line pt-4">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>Progression</span>
                <span className="font-mono">
                  {deliveredCount}/{LOTS.length}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Lots livrés"
                aria-valuemin={0}
                aria-valuemax={LOTS.length}
                aria-valuenow={deliveredCount}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas"
              >
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${(deliveredCount / LOTS.length) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="catalog-title" className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
                Référentiel
              </p>
              <h2 id="catalog-title" className="mt-1 text-sm font-semibold">
                Les données prêtes pour les achats.
              </h2>
            </div>
            <p className="text-[11px] text-muted">Import XLSX · rapport par ligne</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                href: "/tiers",
                label: "Tiers",
                description: "Clients et fournisseurs, codes uniques",
                count: counts.partners,
                icon: Users,
              },
              {
                href: "/articles",
                label: "Articles",
                description: "Produits classés SH et services",
                count: counts.articles,
                icon: Package,
              },
              {
                href: "/nomenclature",
                label: "Nomenclature",
                description: "Codes SH à 6, 8 ou 10 chiffres",
                count: counts.hsCodes,
                icon: Barcode,
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group rounded-xl border border-line bg-panel p-4 transition-colors hover:border-brand/30"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-4 text-brand" aria-hidden="true" />
                    <span className="font-mono text-2xl tabular-nums">{card.count}</span>
                  </div>
                  <p className="mt-4 text-sm font-medium">{card.label}</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted">{card.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[10px] text-brand">
                    Ouvrir
                    <ArrowUpRight
                      className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section
          aria-labelledby="roadmap-title"
          className="mt-12 overflow-hidden rounded-xl border border-line bg-panel"
        >
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
                Feuille de route
              </p>
              <h2 id="roadmap-title" className="mt-1 text-sm font-semibold">
                Huit lots, une barrière identique.
              </h2>
            </div>
            <p className="text-[11px] text-muted">Gate vert, puis push.</p>
          </div>

          <ol>
            {LOTS.map((lot) => {
              const meta = STATUS_META[lot.status];
              const Icon = meta.icon;

              return (
                <li
                  key={lot.id}
                  className="grid gap-2 border-b border-line px-5 py-3.5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                >
                  <span className="font-mono text-[11px] text-muted">
                    {String(lot.id).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{lot.title}</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted">{lot.scope}</p>
                  </div>
                  <span
                    className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${meta.badge}`}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-4 grid gap-4 md:grid-cols-3">
          <article className="flex flex-col rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Barrière de qualité</h2>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              Identique en local et sur GitHub Actions. Aucun lot ne part sans elle.
            </p>
            <ul className="mt-4 space-y-1.5">
              {GATE.map((step) => (
                <li
                  key={step.command}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-3 py-2"
                >
                  <span className="text-[11px] font-medium">{step.label}</span>
                  <code className="font-mono text-[10px] text-muted">{step.command}</code>
                </li>
              ))}
            </ul>
          </article>

          <article className="flex flex-col rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Stack verrouillée</h2>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              Aucun service permanent sur la machine : build local, exécution sur Vercel.
            </p>
            <dl className="mt-4 space-y-2.5">
              {STACK.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5 last:border-b-0 last:pb-0"
                >
                  <dt className="text-[11px] text-muted">{row.label}</dt>
                  <dd className="text-right text-[11px] font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </article>

          {nextLot ? (
            <article className="relative flex flex-col overflow-hidden rounded-xl bg-brand p-5 text-white">
              <ArrowUpRight
                className="absolute top-4 right-4 size-4 text-white/40"
                aria-hidden="true"
              />
              <p className="font-mono text-[10px] tracking-[0.18em] text-white/60 uppercase">
                Prochain · Lot {String(nextLot.id).padStart(2, "0")}
              </p>
              <h2 className="mt-2 text-lg font-medium tracking-tight">{nextLot.title}</h2>
              <p className="mt-2 text-[11px] leading-5 text-white/70">
                {nextLot.scope}. Le référentiel livré au Lot 02 alimente directement les commandes,
                les réceptions et les mouvements de stock.
              </p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {["Commandes fournisseur", "Réceptions", "Stock", "Traçabilité"].map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/75"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center gap-2 pt-5 font-mono text-[10px] text-white/45">
                <Database className="size-3" aria-hidden="true" />
                docs/business-rules.md
              </div>
            </article>
          ) : null}
        </section>

        <footer className="mt-10 flex flex-col gap-2 border-t border-line pt-5 text-[11px] leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Référence métier lue en lecture seule, règles reformulées, aucun code copié.</p>
          <p className="font-mono">docs/business-rules.md · docs/conventions.md</p>
        </footer>
      </main>
    </div>
  );
}
