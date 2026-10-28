"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  Check,
  Landmark,
  LoaderCircle,
  Percent,
  Power,
  Save,
  ShieldCheck,
  Stamp,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { EMPTY_CUSTOMS_FORM_STATE } from "@/lib/customs/form-state";
import {
  addDeclarationLineAction,
  apureBondAction,
  createBondAction,
  createDeclarationAction,
  createOfficeAction,
  createRegimeAction,
  createTaxAction,
  recordCustomsPaymentAction,
  toggleOfficeAction,
  toggleRegimeAction,
  toggleTaxAction,
  updateDeclarationAction,
} from "@/lib/customs/actions";
import { formatXof } from "@/lib/money";
import { COUNTRY_CODES, UNITS } from "@/modules/catalog/constants";
import { CUSTOMS_REGIME_KINDS, CUSTOMS_REGIME_KIND_LABELS } from "@/modules/customs/constants";
import type { CustomsDeclarationOptions } from "@/modules/customs/queries";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/modules/sales/payment-methods";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

export interface DeclarationHeaderValues {
  readonly id: string;
  readonly regimeId: string;
  readonly officeId: string;
  readonly partnerId: string;
  readonly declarationDate: string;
  readonly externalReference: string | null;
  readonly freightAmount: number;
  readonly insuranceAmount: number;
}

export function DeclarationHeaderForm({
  options,
  declaration,
  today,
}: {
  options: CustomsDeclarationOptions;
  declaration?: DeclarationHeaderValues;
  today: string;
}) {
  const isEdit = declaration !== undefined;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateDeclarationAction : createDeclarationAction,
    EMPTY_CUSTOMS_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      className={
        isEdit
          ? "mt-4 rounded-xl border border-line bg-panel p-5"
          : "mt-6 space-y-4 rounded-xl border border-line bg-panel p-5"
      }
    >
      {isEdit ? <input type="hidden" name="declarationId" value={declaration.id} /> : null}
      <FormErrors errors={state.errors} />

      <div>
        <h2 className="text-sm font-semibold">
          {isEdit ? "Modifier l'en-tête" : "En-tête de la déclaration"}
        </h2>
        <p className="mt-1 text-[10px] leading-4 text-muted">
          {isEdit
            ? "Seule une déclaration en brouillon accepte une modification."
            : "La déclaration est créée en brouillon et reçoit son numéro DEC immédiatement."}
        </p>
      </div>

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">En-tête de déclaration</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Régime douanier" htmlFor="regimeId" hint="Référentiel actif uniquement.">
            <select
              id="regimeId"
              name="regimeId"
              required
              defaultValue={declaration?.regimeId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un régime
              </option>
              {options.regimes.map((regime) => (
                <option key={regime.id} value={regime.id}>
                  {regime.code} · {regime.label}
                  {regime.requiresBond ? " (acquit)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bureau de douane" htmlFor="officeId" hint="Bureau actif de l'espace.">
            <select
              id="officeId"
              name="officeId"
              required
              defaultValue={declaration?.officeId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un bureau
              </option>
              {options.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.code} · {office.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Tiers déclaré"
            htmlFor="partnerId"
            hint="Client, importateur ou exportateur."
          >
            <select
              id="partnerId"
              name="partnerId"
              required
              defaultValue={declaration?.partnerId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un tiers
              </option>
              {options.partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.code} · {partner.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date de déclaration" htmlFor="declarationDate" hint="Format AAAA-MM-JJ.">
            <input
              id="declarationDate"
              name="declarationDate"
              type="date"
              required
              defaultValue={declaration?.declarationDate ?? today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Référence externe"
            htmlFor="externalReference"
            hint="60 caractères maximum, facultative."
          >
            <input
              id="externalReference"
              name="externalReference"
              maxLength={60}
              defaultValue={declaration?.externalReference ?? ""}
              placeholder="SYDONIA-2026-0142"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Frais de transport"
            htmlFor="freightAmountXof"
            hint="XOF entier, réparti au prorata des valeurs."
          >
            <input
              id="freightAmountXof"
              name="freightAmountXof"
              inputMode="numeric"
              defaultValue={declaration?.freightAmount ?? ""}
              placeholder="0"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field
            label="Frais d'assurance"
            htmlFor="insuranceAmountXof"
            hint="XOF entier, réparti au prorata des valeurs."
          >
            <input
              id="insuranceAmountXof"
              name="insuranceAmountXof"
              inputMode="numeric"
              defaultValue={declaration?.insuranceAmount ?? ""}
              placeholder="0"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          {isEdit ? (
            <span className="text-[10px] text-muted">
              Les totaux seront recalculés à la prochaine liquidation.
            </span>
          ) : (
            <Link
              href="/douane"
              aria-label="Annuler et revenir aux déclarations"
              title="Annuler"
              className={SECONDARY}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          )}
          <button
            type="submit"
            disabled={pending}
            aria-label={isEdit ? "Enregistrer l'en-tête" : "Créer la déclaration en brouillon"}
            title={isEdit ? "Enregistrer l'en-tête" : "Créer la déclaration"}
            className={`${SUBMIT} ${isEdit ? "" : "ml-auto"}`}
          >
            <SubmitIcon pending={pending} icon={isEdit ? Save : Landmark} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function DeclarationLineForm({
  declarationId,
  hsCodes,
}: {
  declarationId: string;
  hsCodes: CustomsDeclarationOptions["hsCodes"];
}) {
  const [state, formAction, pending] = useActionState(
    addDeclarationLineAction,
    EMPTY_CUSTOMS_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="declarationId" value={declarationId} />
      <FormErrors errors={state.errors} />

      <div>
        <h2 className="text-sm font-semibold">Ajouter une ligne</h2>
        <p className="mt-1 text-[10px] leading-4 text-muted">
          Le taux TEC vient de la nomenclature. Sans taux, la liquidation refusera la déclaration.
        </p>
      </div>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Nouvelle ligne de déclaration</legend>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Code SH" htmlFor="hsCode" hint="6, 8 ou 10 chiffres.">
            <input
              id="hsCode"
              name="hsCode"
              required
              list="douane-hs-codes"
              placeholder="090111"
              className={`${INPUT_CLASS} font-mono`}
            />
            <datalist id="douane-hs-codes">
              {hsCodes.map((hsCode) => (
                <option key={hsCode.code} value={hsCode.code}>
                  {hsCode.wording}
                  {hsCode.tecRate === null ? " · TEC manquant" : ` · TEC ${hsCode.tecRate} %`}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Désignation" htmlFor="designation" hint="160 caractères maximum.">
            <input
              id="designation"
              name="designation"
              required
              maxLength={160}
              placeholder="Café vert non torréfié"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Quantité" htmlFor="quantity" hint="Six décimales au plus.">
            <input
              id="quantity"
              name="quantity"
              required
              inputMode="decimal"
              placeholder="1 250,5"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Unité" htmlFor="unitCode">
            <select
              id="unitCode"
              name="unitCode"
              required
              defaultValue="KG"
              className={INPUT_CLASS}
            >
              {UNITS.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} · {unit.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Valeur en douane"
            htmlFor="valueXof"
            hint="XOF entier, hors fret et assurance."
          >
            <input
              id="valueXof"
              name="valueXof"
              required
              inputMode="numeric"
              placeholder="4500000"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Poids net" htmlFor="weightKg" hint="Kilogrammes, facultatif.">
            <input
              id="weightKg"
              name="weightKg"
              inputMode="decimal"
              placeholder="1250,5"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Pays d'origine" htmlFor="originCountry">
            <select
              id="originCountry"
              name="originCountry"
              required
              defaultValue=""
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un pays
              </option>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            aria-label="Ajouter la ligne"
            title="Ajouter la ligne"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Check} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function BondForm({
  declarationId,
  grandTotal,
}: {
  declarationId: string;
  grandTotal: number;
}) {
  const [state, formAction, pending] = useActionState(createBondAction, EMPTY_CUSTOMS_FORM_STATE);

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="declarationId" value={declarationId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Ouvrir un acquit-à-caution</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Garantie minimale {formatXof(grandTotal)}. Un seul acquit par déclaration, apuré une seule
        fois.
      </p>

      <fieldset
        disabled={pending}
        className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-end"
      >
        <legend className="sr-only">Acquit-à-caution</legend>
        <Field label="Montant de garantie" htmlFor="guaranteeAmountXof" hint="XOF entier.">
          <input
            id="guaranteeAmountXof"
            name="guaranteeAmountXof"
            required
            inputMode="numeric"
            defaultValue={grandTotal}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </Field>
        <Field label="Référence de garantie" htmlFor="guaranteeReference">
          <input
            id="guaranteeReference"
            name="guaranteeReference"
            required
            maxLength={120}
            placeholder="GAR-2026-0018"
            className={INPUT_CLASS}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Ouvrir l'acquit-à-caution"
          title="Ouvrir l'acquit"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={ShieldCheck} />
        </button>
      </fieldset>
    </form>
  );
}

export function ApurementForm({
  bondId,
  declarationId,
}: {
  bondId: string;
  declarationId?: string;
}) {
  const [state, formAction, pending] = useActionState(apureBondAction, EMPTY_CUSTOMS_FORM_STATE);

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="bondId" value={bondId} />
      {declarationId ? <input type="hidden" name="declarationId" value={declarationId} /> : null}
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field label="Référence d'apurement" htmlFor={`apurement-${bondId}`}>
            <input
              id={`apurement-${bondId}`}
              name="reference"
              required
              maxLength={120}
              placeholder="APU-2026-0007"
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-label="Apurer l'acquit-à-caution"
          title="Apurer l'acquit"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Stamp} />
        </button>
      </div>
    </form>
  );
}

export function CustomsPaymentForm({
  declarationId,
  balanceXof,
  today,
}: {
  declarationId: string;
  balanceXof: number;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordCustomsPaymentAction,
    EMPTY_CUSTOMS_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="declarationId" value={declarationId} />
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <Banknote className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Enregistrer un paiement</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        Reste à payer {formatXof(balanceXof)}. Le journal des paiements est append-only.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">Paiement de la déclaration</legend>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Montant" htmlFor="amountXof" hint="XOF entier.">
            <input
              id="amountXof"
              name="amountXof"
              required
              inputMode="numeric"
              max={balanceXof}
              placeholder={String(balanceXof)}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Date" htmlFor="paidDate" hint="Aujourd'hui ou passée.">
            <input
              id="paidDate"
              name="paidDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Moyen" htmlFor="method">
            <select
              id="method"
              name="method"
              required
              defaultValue="transfer"
              className={INPUT_CLASS}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Référence" htmlFor="reference" hint="120 caractères maximum.">
            <input
              id="reference"
              name="reference"
              maxLength={120}
              placeholder="QUIT-2026-0142"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le paiement"
            title="Enregistrer le paiement"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Banknote} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function OfficeForm() {
  const [state, formAction, pending] = useActionState(createOfficeAction, EMPTY_CUSTOMS_FORM_STATE);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)_auto] sm:items-end"
      >
        <legend className="sr-only">Nouveau bureau de douane</legend>
        <Field label="Code UN/LOCODE" htmlFor="office-code" hint="Cinq caractères, ex. CIABJ.">
          <input
            id="office-code"
            name="code"
            required
            maxLength={5}
            placeholder="CIABJ"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Nom du bureau" htmlFor="office-name">
          <input
            id="office-name"
            name="name"
            required
            maxLength={120}
            placeholder="Abidjan Port"
            className={INPUT_CLASS}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Ajouter le bureau"
          title="Ajouter le bureau"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Landmark} />
        </button>
      </fieldset>
    </form>
  );
}

export function RegimeForm() {
  const [state, formAction, pending] = useActionState(createRegimeAction, EMPTY_CUSTOMS_FORM_STATE);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto] lg:items-end"
      >
        <legend className="sr-only">Nouveau régime douanier</legend>
        <Field label="Code" htmlFor="regime-code" hint="2 à 6 caractères.">
          <input
            id="regime-code"
            name="code"
            required
            maxLength={6}
            placeholder="IM4"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Libellé" htmlFor="regime-label">
          <input
            id="regime-label"
            name="label"
            required
            maxLength={120}
            placeholder="Mise à la consommation"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Nature" htmlFor="regime-kind">
          <select
            id="regime-kind"
            name="kind"
            required
            defaultValue="import"
            className={INPUT_CLASS}
          >
            {CUSTOMS_REGIME_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CUSTOMS_REGIME_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[11px]">
          <input type="checkbox" name="requiresBond" className="size-3.5 accent-brand" />
          Acquit requis
        </label>
        <button
          type="submit"
          disabled={pending}
          aria-label="Ajouter le régime"
          title="Ajouter le régime"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Check} />
        </button>
      </fieldset>
    </form>
  );
}

export function TaxForm() {
  const [state, formAction, pending] = useActionState(createTaxAction, EMPTY_CUSTOMS_FORM_STATE);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.4fr)_auto] lg:items-end"
      >
        <legend className="sr-only">Nouvelle taxe douanière</legend>
        <Field label="Code" htmlFor="tax-code" hint="2 à 6 caractères.">
          <input
            id="tax-code"
            name="code"
            required
            maxLength={6}
            placeholder="TVA"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Libellé" htmlFor="tax-label">
          <input
            id="tax-label"
            name="label"
            required
            maxLength={120}
            placeholder="Taxe sur la valeur ajoutée"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Assiette" htmlFor="tax-base">
          <select
            id="tax-base"
            name="base"
            required
            defaultValue="cif_plus_duty"
            className={INPUT_CLASS}
          >
            <option value="cif">Valeur CIF</option>
            <option value="cif_plus_duty">CIF + droits</option>
          </select>
        </Field>
        <Field label="Taux (%)" htmlFor="tax-rate" hint="Deux décimales.">
          <input
            id="tax-rate"
            name="rateBp"
            required
            inputMode="decimal"
            placeholder="18"
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </Field>
        <Field label="Ordre" htmlFor="tax-position">
          <input
            id="tax-position"
            name="position"
            inputMode="numeric"
            defaultValue="10"
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Ajouter la taxe"
          title="Ajouter la taxe"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Percent} />
        </button>
      </fieldset>
    </form>
  );
}

export function ReferentialToggle({
  kind,
  id,
  active,
  label,
}: {
  kind: "office" | "regime" | "tax";
  id: string;
  active: boolean;
  label: string;
}) {
  const action =
    kind === "office"
      ? toggleOfficeAction
      : kind === "regime"
        ? toggleRegimeAction
        : toggleTaxAction;
  const [state, formAction, pending] = useActionState(action, EMPTY_CUSTOMS_FORM_STATE);
  const field = kind === "office" ? "officeId" : kind === "regime" ? "regimeId" : "taxId";

  return (
    <form action={formAction}>
      <input type="hidden" name={field} value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={active ? `Désactiver ${label}` : `Activer ${label}`}
        title={active ? "Désactiver" : "Activer"}
        className={`grid size-7 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          active
            ? "border-line bg-panel text-muted hover:border-copper/30 hover:text-copper"
            : "border-brand/20 bg-brand-soft text-brand-strong hover:border-brand/40"
        }`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Power className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function ReferentialIcon({ kind }: { kind: "office" | "regime" | "tax" }) {
  const Icon = kind === "office" ? Landmark : kind === "regime" ? Tags : Percent;
  return <Icon className="size-4 text-brand" aria-hidden="true" />;
}
