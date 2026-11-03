import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { StockSettingsForm } from "@/components/stock-forms";
import { getDb } from "@/db/client";
import { getAccessLevels, requireModule } from "@/lib/auth/session";
import { isoDateLabel } from "@/lib/dates";
import { atLeast } from "@/modules/identity/modules";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listInternalLocations } from "@/modules/stock/locations";
import { getStockSettingsView } from "@/modules/stock/settings";
import { formatQuantity } from "@/modules/stock/quantities";

export const metadata: Metadata = {
  title: "Paramètres du stock",
};

export default function StockSettingsPage(props: PageProps<"/stock/parametres">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement des paramètres…" />}>
      <StockSettingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function StockSettingsContent({
  searchParams,
}: Pick<PageProps<"/stock/parametres">, "searchParams">) {
  await connection();
  const session = await requireModule("stock", "read");
  const query = await searchParams;
  const db = getDb();
  const [locations, settings, memberships, levels] = await Promise.all([
    listInternalLocations(db, session.tenantId),
    getStockSettingsView(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
    getAccessLevels(session),
  ]);
  const canManage = atLeast(levels.stock, "manage");
  const saved = query.enregistre !== undefined;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="stock" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex items-center gap-3">
          <Link
            href="/stock"
            aria-label="Revenir au stock"
            title="Revenir au stock"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">Stock</p>
            <h1 className="text-2xl font-medium tracking-tight">Paramètres du stock</h1>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Le paramétrage est unique par espace. Le magasin par défaut est proposé lors d&apos;une
          réception, le seuil sert de référence de réapprovisionnement et le motif d&apos;ajustement
          peut devenir obligatoire. Sans paramétrage, le motif reste obligatoire et aucun magasin
          n&apos;est proposé par défaut.
        </p>

        {saved ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong"
          >
            Paramétrage enregistré.
          </p>
        ) : null}

        {settings === null ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
          >
            Aucun paramétrage : les valeurs par défaut s&apos;appliquent. Enregistrez pour choisir
            un magasin par défaut et fixer le seuil.
          </p>
        ) : (
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Magasin par défaut</dt>
              <dd className="mt-1 font-mono text-sm">
                {settings.defaultLocationCode
                  ? `${settings.defaultLocationCode} · ${settings.defaultLocationName ?? ""}`
                  : "Aucun"}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Seuil de réapprovisionnement</dt>
              <dd className="mt-1 font-mono text-sm">
                {formatQuantity(settings.defaultMinStockQty)}
              </dd>
            </div>
            <div className="rounded-lg border border-line bg-panel px-4 py-3">
              <dt className="text-[10px] text-muted">Motif d&apos;ajustement</dt>
              <dd className="mt-1 font-mono text-sm">
                {settings.adjustmentReasonRequired ? "Obligatoire" : "Facultatif"}
              </dd>
            </div>
          </dl>
        )}

        {settings ? (
          <p className="mt-2 text-[10px] text-muted">
            Dernière mise à jour le {isoDateLabel(settings.updatedAt.toISOString().slice(0, 10))}.
          </p>
        ) : null}

        {canManage ? (
          <section className="mt-5 rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {settings === null ? "Définir le paramétrage" : "Modifier le paramétrage"}
              </h2>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Le stock négatif reste interdit : le paramétrage ne l&apos;autorise jamais.
            </p>
            <StockSettingsForm
              locations={locations}
              values={
                settings
                  ? {
                      defaultInternalLocationId: settings.defaultInternalLocationId,
                      defaultMinStockQty: settings.defaultMinStockQty,
                      adjustmentReasonRequired: settings.adjustmentReasonRequired,
                    }
                  : null
              }
            />
          </section>
        ) : (
          <p className="mt-5 text-[11px] text-muted">
            Seul un rôle disposant du niveau gestion peut modifier ce paramétrage.
          </p>
        )}
      </main>
    </div>
  );
}
