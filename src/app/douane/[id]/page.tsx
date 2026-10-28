import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Landmark, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  ApurementForm,
  BondForm,
  CustomsPaymentForm,
  DeclarationHeaderForm,
  DeclarationLineForm,
} from "@/components/customs-forms";
import { BondStatusBadge, DeclarationStatusBadge } from "@/components/customs-badges";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { CUSTOMS_TAX_BASE_LABELS } from "@/modules/customs/constants";
import { DECLARATION_TRANSITIONS, type DeclarationTransition } from "@/modules/customs/lifecycle";
import { getDeclaration, getDeclarationOptions } from "@/modules/customs/queries";
import { PAYMENT_METHOD_LABELS } from "@/modules/sales/payment-methods";
import { formatQuantity } from "@/modules/stock/quantities";
import { RemoveLineButton } from "./remove-line-button";
import { TransitionButton } from "./transition-button";

export const metadata: Metadata = {
  title: "Déclaration en douane",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = "px-4 py-2.5 font-normal";
const TRANSITION_ORDER: readonly DeclarationTransition[] = [
  "deposit",
  "liquidate",
  "clear",
  "cancel",
];

function bannerFor(query: Record<string, string | string[] | undefined>): string | null {
  if (typeof query.cree === "string") {
    return "Déclaration créée en brouillon. Ajoutez au moins une ligne avant le dépôt.";
  }
  if (typeof query.maj === "string") {
    return "Déclaration mise à jour.";
  }
  return null;
}

export default function DeclarationPage(props: PageProps<"/douane/[id]">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de la déclaration…" />}>
      <DeclarationContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function DeclarationContent({
  params,
  searchParams,
}: Pick<PageProps<"/douane/[id]">, "params" | "searchParams">) {
  await connection();
  const session = await requirePermission("data.read");
  const { id: declarationId } = await params;
  if (!UUID_PATTERN.test(declarationId)) {
    notFound();
  }

  const db = getDb();
  const [declaration, memberships, query] = await Promise.all([
    getDeclaration(db, { tenantId: session.tenantId, declarationId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
  ]);
  if (!declaration) {
    notFound();
  }

  const canWrite = can(session.role, "data.write");
  const isDraft = declaration.status === "draft";
  const options = canWrite && isDraft ? await getDeclarationOptions(db, session.tenantId) : null;
  const banner = bannerFor(query);
  const balance = declaration.grandTotal - declaration.paidTotal;
  const today = todayIsoDate();

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="customs" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/douane"
            aria-label="Revenir aux déclarations"
            title="Revenir aux déclarations"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Déclaration en douane
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-medium tracking-tight">
                {declaration.number}
              </h1>
              <DeclarationStatusBadge status={declaration.status} />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {declaration.regimeCode} · {declaration.regimeLabel} · bureau{" "}
              <span className="font-mono">{declaration.officeCode}</span> ·{" "}
              {declaration.partnerName} · déclarée le {isoDateLabel(declaration.declarationDate)}
            </p>
          </div>

          {canWrite ? (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {TRANSITION_ORDER.filter((transition) =>
                DECLARATION_TRANSITIONS[transition].from.includes(declaration.status),
              ).map((transition) => (
                <TransitionButton
                  key={transition}
                  declarationId={declaration.id}
                  transition={transition}
                />
              ))}
              <Link
                href="/douane/acquits"
                aria-label="Ouvrir les acquits-à-caution"
                title="Acquits-à-caution"
                className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </div>

        {banner ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {banner}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Valeur CIF</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">
              {formatXof(declaration.cifTotal)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Droits de douane</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">
              {formatXof(declaration.dutyTotal)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Taxes</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">
              {formatXof(declaration.taxTotal)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Total dû</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">
              {formatXof(declaration.grandTotal)}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Reste à payer</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">
              {formatXof(Math.max(balance, 0))}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-muted">
          <span>
            Fret {formatXof(declaration.freightAmount)} · assurance{" "}
            {formatXof(declaration.insuranceAmount)}
          </span>
          <span>
            Tiers <span className="font-mono">{declaration.partnerCode}</span> ·{" "}
            {declaration.officeName}
          </span>
          {declaration.externalReference ? (
            <span>
              Référence <span className="font-mono">{declaration.externalReference}</span>
            </span>
          ) : null}
          {declaration.liquidatedAt ? (
            <span>
              Liquidée le {isoDateLabel(declaration.liquidatedAt.toISOString().slice(0, 10))}
            </span>
          ) : null}
        </div>

        {options ? (
          <DeclarationHeaderForm
            options={options}
            today={today}
            declaration={{
              id: declaration.id,
              regimeId: declaration.regimeId,
              officeId: declaration.officeId,
              partnerId: declaration.partnerId,
              declarationDate: declaration.declarationDate,
              externalReference: declaration.externalReference,
              freightAmount: declaration.freightAmount,
              insuranceAmount: declaration.insuranceAmount,
            }}
          />
        ) : null}

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Landmark className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Lignes</h2>
            <span className="font-mono text-[10px] text-muted">{declaration.lines.length}</span>
            <span className="ml-auto text-[10px] text-muted">Code TEC issu de la nomenclature</span>
          </div>

          {declaration.lines.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] leading-5 text-muted">
              Aucune ligne. Ajoutez-les une par une ou importez le modèle XLSX ; une déclaration ne
              peut pas être déposée sans ligne.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Lignes de la déclaration</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Ligne
                    </th>
                    <th scope="col" className={TH}>
                      Code SH
                    </th>
                    <th scope="col" className={TH}>
                      Désignation
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Quantité
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Valeur
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      CIF
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      TEC
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Droit
                    </th>
                    {isDraft && canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Retirer
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {declaration.lines.map((line) => (
                    <tr key={line.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-mono text-[10px] text-muted tabular-nums">
                        {String(line.lineNumber).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {line.hsCode}
                      </td>
                      <td className="max-w-64 px-4 py-2.5">
                        <span className="block truncate">{line.designation}</span>
                        <span className="block text-[10px] text-muted">
                          Origine {line.originCountry}
                          {line.weightKg ? ` · ${formatQuantity(line.weightKg)} kg` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.quantity)} {line.unitCode}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(line.valueXof)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {declaration.status === "draft" ? "—" : formatXof(line.cifValue)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {line.dutyRate === null ? "—" : `${line.dutyRate} %`}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {declaration.status === "draft" ? "—" : formatXof(line.dutyAmount)}
                      </td>
                      {isDraft && canWrite ? (
                        <td className="px-4 py-2.5">
                          <RemoveLineButton
                            declarationId={declaration.id}
                            lineId={line.id}
                            lineNumber={line.lineNumber}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {options ? (
          <DeclarationLineForm declarationId={declaration.id} hsCodes={options.hsCodes} />
        ) : null}

        {declaration.taxes.length > 0 ? (
          <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <ReceiptText className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Taxes liquidées</h2>
              <span className="ml-auto text-[10px] text-muted">Snapshot de la liquidation</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Taxes figées lors de la liquidation</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Taxe
                    </th>
                    <th scope="col" className={TH}>
                      Assiette
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Base
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Taux
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Montant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {declaration.taxes.map((tax) => (
                    <tr key={tax.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{tax.label}</span>
                        <span className="block font-mono text-[10px] text-muted">{tax.code}</span>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {CUSTOMS_TAX_BASE_LABELS[tax.base]}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(tax.baseAmount)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {(tax.rateBp / 100).toFixed(2).replace(".", ",")} %
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(tax.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {declaration.requiresBond ? (
          <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Acquit-à-caution</h2>
              {declaration.bond ? <BondStatusBadge status={declaration.bond.status} /> : null}
              <span className="ml-auto text-[10px] text-muted">Exigé par le régime</span>
            </div>

            {declaration.bond ? (
              <div className="px-5 py-4">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-[10px] text-muted">Numéro</dt>
                    <dd className="mt-0.5 font-mono text-[11px]">{declaration.bond.number}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted">Garantie</dt>
                    <dd className="mt-0.5 font-mono text-[11px] tabular-nums">
                      {formatXof(declaration.bond.guaranteeAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted">Montant en jeu</dt>
                    <dd className="mt-0.5 font-mono text-[11px] tabular-nums">
                      {formatXof(declaration.bond.amountAtRisk)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted">Référence de garantie</dt>
                    <dd className="mt-0.5 truncate font-mono text-[11px]">
                      {declaration.bond.guaranteeReference}
                    </dd>
                  </div>
                  {declaration.bond.apurementReference ? (
                    <div>
                      <dt className="text-[10px] text-muted">Apurement</dt>
                      <dd className="mt-0.5 truncate font-mono text-[11px]">
                        {declaration.bond.apurementReference}
                      </dd>
                    </div>
                  ) : null}
                  {declaration.bond.apuredAt ? (
                    <div>
                      <dt className="text-[10px] text-muted">Apuré le</dt>
                      <dd className="mt-0.5 text-[11px] tabular-nums">
                        {isoDateLabel(declaration.bond.apuredAt.toISOString().slice(0, 10))}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {canWrite && declaration.bond.status === "open" ? (
                  <ApurementForm bondId={declaration.bond.id} declarationId={declaration.id} />
                ) : null}
              </div>
            ) : canWrite && declaration.status === "liquidated" ? (
              <div className="px-5 py-4">
                <BondForm declarationId={declaration.id} grandTotal={declaration.grandTotal} />
              </div>
            ) : (
              <p className="px-5 py-6 text-[11px] text-muted">
                L&apos;acquit s&apos;ouvre après la liquidation, pour une garantie au moins égale au
                total dû.
              </p>
            )}
          </section>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Wallet className="size-4 text-brand" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Paiements</h2>
            <span className="font-mono text-[10px] text-muted">
              {formatXof(declaration.paidTotal)}
            </span>
            <span className="ml-auto text-[10px] text-muted">Journal append-only</span>
          </div>

          {declaration.payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-muted">
              Aucun paiement. La mainlevée exige le règlement intégral du total dû.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Paiements enregistrés sur la déclaration</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Moyen
                    </th>
                    <th scope="col" className={TH}>
                      Référence
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Montant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {declaration.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {isoDateLabel(payment.paidAt)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-muted">
                        {payment.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {formatXof(payment.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canWrite && declaration.status === "liquidated" && balance > 0 ? (
          <CustomsPaymentForm declarationId={declaration.id} balanceXof={balance} today={today} />
        ) : null}

        {declaration.status === "cleared" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Mainlevée accordée : la déclaration est close et n&apos;accepte plus de paiement.
          </p>
        ) : declaration.status === "cancelled" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Déclaration annulée : l&apos;historique reste consultable, aucune action n&apos;est
            possible.
          </p>
        ) : declaration.status === "draft" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Prochaine étape : déposer la déclaration, puis la liquider pour figer les droits et les
            taxes.
          </p>
        ) : declaration.status === "deposited" ? (
          <p className="mt-4 text-[10px] leading-4 text-muted">
            Prochaine étape : liquider la déclaration. Chaque code SH doit porter un taux TEC.
          </p>
        ) : null}
      </main>
    </div>
  );
}
