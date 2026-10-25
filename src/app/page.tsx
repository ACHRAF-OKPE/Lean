import {
  ArrowUpRight,
  Check,
  CircleDot,
  Database,
  GitBranch,
  Layers,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { LOTS, type LotStatus } from "@/lib/lots";

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

export default function Home() {
  const deliveredCount = LOTS.filter((lot) => lot.status === "done").length;
  const nextLot = LOTS.find((lot) => lot.status === "next");

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
            >
              L
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Lean</p>
              <p className="text-[11px] text-muted">ERP supply chain &amp; douane</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[10px] text-muted">
              {deliveredCount} / {LOTS.length} lots livrés
            </span>
            <a
              href="https://github.com/ACHRAF-OKPE/Lean"
              target="_blank"
              rel="noreferrer"
              aria-label="Ouvrir le dépôt GitHub"
              title="Dépôt GitHub"
              className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <GitBranch className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] lg:items-end">
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-brand uppercase">
              Lot 00 · livré
            </p>
            <h1 className="mt-5 max-w-2xl text-4xl leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-5xl md:text-[3.25rem]">
              Le socle est posé.
              <span className="block">Les règles prennent le relais.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
              Lean relie les achats, le stock, les ventes, la douane et la comptabilité SYSCOHADA
              dans un même socle multi-tenant. Chaque règle métier est identifiée, sourcée et
              vérifiée avant d&apos;entrer en production.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium">Dossier de livraison</p>
              <span className="rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 font-mono text-[10px] text-brand-strong">
                L00
              </span>
            </div>

            <dl className="mt-5 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Lot courant</dt>
                <dd className="text-right text-[11px] font-medium">Socle technique</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Données</dt>
                <dd className="text-right text-[11px] font-medium">Neon Postgres</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Hébergement</dt>
                <dd className="text-right text-[11px] font-medium">Vercel</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-muted">Référence</dt>
                <dd className="text-right text-[11px] font-medium">Axelor, lecture seule</dd>
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
                Poser l&apos;authentification, l&apos;isolation tenant et le journal d&apos;audit
                avant toute donnée métier.
              </p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {["Tenants", "Auth", "Rôles", "Audit"].map((tag) => (
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
                src/db/schema.ts
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
