import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Sparkles,
} from "lucide-react";
import type { BriefingAlert, MorningBriefing } from "@/modules/dashboard/briefing";

interface Props {
  readonly briefing: MorningBriefing;
}

const SEVERITY_CONFIG: Record<
  BriefingAlert["severity"],
  {
    cardClass: string;
    badgeClass: string;
    icon: typeof AlertCircle;
    iconColor: string;
  }
> = {
  urgent: {
    cardClass: "border-rose-200 dark:border-rose-950/40 bg-rose-50/50 dark:bg-rose-950/10",
    badgeClass: "border-rose-200 bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
    icon: AlertCircle,
    iconColor: "text-rose-600 dark:text-rose-400",
  },
  warning: {
    cardClass: "border-amber-200 dark:border-amber-950/40 bg-amber-50/50 dark:bg-amber-950/10",
    badgeClass:
      "border-amber-200 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    icon: Clock,
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  info: {
    cardClass: "border-sky-200 dark:border-sky-950/40 bg-sky-50/50 dark:bg-sky-950/10",
    badgeClass: "border-sky-200 bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    icon: AlertTriangle,
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  success: {
    cardClass:
      "border-emerald-200 dark:border-emerald-950/40 bg-emerald-50/50 dark:bg-emerald-950/10",
    badgeClass:
      "border-emerald-200 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    icon: CheckCircle2,
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
};

export function MorningBriefingCard({ briefing }: Props) {
  const { dateFormatted, greeting, totalAlerts, urgentCount, alerts, metrics } = briefing;

  return (
    <section
      aria-labelledby="morning-briefing-title"
      className="rounded-2xl border border-line bg-panel p-6 shadow-xs md:p-8"
    >
      {/* En-tête du briefing */}
      <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <p className="font-mono text-xs tracking-[0.16em] text-brand uppercase">
              Briefing Matinal · {dateFormatted}
            </p>
          </div>
          <h2
            id="morning-briefing-title"
            className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {greeting}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {totalAlerts === 0
              ? "Toutes vos opérations sont à jour. Aucun point bloquant ce matin."
              : `${totalAlerts} point${totalAlerts > 1 ? "s" : ""} opérationnel${totalAlerts > 1 ? "s" : ""} requièrent votre vigilance, dont ${urgentCount} urgent${urgentCount > 1 ? "s" : ""}.`}
          </p>
        </div>

        {/* Compteurs de synthèse rapide */}
        <div className="flex flex-wrap gap-2 sm:self-center">
          {metrics.matchingDisputesCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 dark:bg-rose-950/20 dark:text-rose-300">
              <span className="size-2 animate-pulse rounded-full bg-rose-500" />
              {metrics.matchingDisputesCount} litige{metrics.matchingDisputesCount > 1 ? "s" : ""}{" "}
              3-Way Match
            </div>
          )}
          {metrics.delayedPurchasesCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <span className="size-2 rounded-full bg-amber-500" />
              {metrics.delayedPurchasesCount} retard{metrics.delayedPurchasesCount > 1 ? "s" : ""}{" "}
              livraison
            </div>
          )}
          {metrics.readyForPaymentCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
              <span className="size-2 rounded-full bg-emerald-500" />
              {metrics.readyForPaymentCount} bon{metrics.readyForPaymentCount > 1 ? "s" : ""} à
              payer
            </div>
          )}
        </div>
      </div>

      {/* Liste des alertes et cartes d'action */}
      {alerts.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-line py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </div>
          <h3 className="mt-3 text-base font-medium">Flux parfaitement fluides</h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            Aucun litige de facture, retard de livraison ou créance échue. Tout est sous contrôle
            pour la journée.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {alerts.map((alert) => {
            const config = SEVERITY_CONFIG[alert.severity];
            const Icon = config.icon;

            return (
              <div
                key={alert.id}
                className={`flex flex-col justify-between rounded-xl border p-5 transition-all hover:shadow-xs ${config.cardClass}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className={`size-5 shrink-0 ${config.iconColor}`} aria-hidden="true" />
                      <h3 className="text-sm font-semibold tracking-tight">{alert.title}</h3>
                    </div>
                    {alert.count !== undefined && (
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${config.badgeClass}`}
                      >
                        {alert.count}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{alert.description}</p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
                  {alert.amountXof !== undefined && alert.amountXof > 0 ? (
                    <span className="font-mono text-xs font-semibold tabular-nums">
                      {alert.amountXof.toLocaleString("fr-FR")} XOF
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-muted">Action immédiate</span>
                  )}
                  <Link
                    href={alert.href}
                    className="bg-surface text-foreground inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium shadow-2xs transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    {alert.actionLabel}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
