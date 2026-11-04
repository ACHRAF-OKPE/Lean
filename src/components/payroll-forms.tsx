"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Plus, Power, Save, type LucideIcon } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { EMPTY_PAYROLL_FORM_STATE } from "@/lib/payroll/form-state";
import {
  createPayrollComponentAction,
  savePayrollSettingsAction,
  setPayrollComponentActiveAction,
  updatePayrollComponentAction,
} from "@/lib/payroll/actions";
import {
  PAYROLL_COMPONENT_KIND_LABELS,
  PAYROLL_COMPONENT_KINDS,
  PAYROLL_COMPONENT_MODE_LABELS,
  PAYROLL_COMPONENT_MODES,
} from "@/modules/payroll/constants";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

/* ------------------------------------------------------------------ rubriques */

export function PayrollComponentForm() {
  const [state, formAction, pending] = useActionState(
    createPayrollComponentAction,
    EMPTY_PAYROLL_FORM_STATE,
  );
  const [mode, setMode] = useState<string>("fixed");

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Nouvelle rubrique de paie</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Code" htmlFor="component-code" hint="2 à 16 caractères, ex. PRIME_ANC.">
            <input
              id="component-code"
              name="code"
              required
              maxLength={16}
              placeholder="PRIME_ANC"
              className={`${INPUT_CLASS} font-mono uppercase`}
            />
          </Field>
          <Field label="Libellé" htmlFor="component-label" hint="80 caractères maximum.">
            <input
              id="component-label"
              name="label"
              required
              maxLength={80}
              placeholder="Prime d'ancienneté"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Type"
            htmlFor="component-kind"
            hint="Un gain s'ajoute, une retenue se déduit."
          >
            <select
              id="component-kind"
              name="kind"
              required
              defaultValue="earning"
              className={INPUT_CLASS}
            >
              {PAYROLL_COMPONENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PAYROLL_COMPONENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Mode de calcul"
            htmlFor="component-mode"
            hint="Le mode reste figé après la création."
          >
            <select
              id="component-mode"
              name="mode"
              required
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className={INPUT_CLASS}
            >
              {PAYROLL_COMPONENT_MODES.map((value) => (
                <option key={value} value={value}>
                  {PAYROLL_COMPONENT_MODE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          {mode === "percent" ? (
            <Field
              label="Taux"
              htmlFor="component-rate"
              hint="Pourcentage entre 0 et 100, six décimales maximum."
            >
              <input
                id="component-rate"
                name="ratePercent"
                required
                inputMode="decimal"
                placeholder="0"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
          ) : (
            <Field label="Montant" htmlFor="component-amount" hint="Montant entier en francs XOF.">
              <input
                id="component-amount"
                name="amountXof"
                required
                inputMode="numeric"
                placeholder="0"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
          )}
        </div>
        <CheckboxField
          name="taxable"
          label="Rubrique imposable"
          hint="Une rubrique imposable entre dans la base de l'impôt sur les salaires."
          defaultChecked
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Créer la rubrique de paie"
            title="Créer la rubrique"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Plus} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * PAY-003 — le code reste immuable : cette fiche corrige le libellé, la valeur (montant ou taux) et
 * le caractère imposable de la rubrique.
 */
export function PayrollComponentRenameForm({
  componentId,
  label,
  mode,
  amountXof,
  ratePercent,
  taxable,
}: {
  componentId: string;
  label: string;
  mode: "fixed" | "percent";
  amountXof: number;
  ratePercent: string;
  taxable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updatePayrollComponentAction,
    EMPTY_PAYROLL_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="componentId" value={componentId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">Modifier la rubrique</legend>
        <div className="min-w-40 flex-1">
          <Field label="Libellé" htmlFor={`component-label-${componentId}`}>
            <input
              id={`component-label-${componentId}`}
              name="label"
              required
              maxLength={80}
              defaultValue={label}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <div className="w-32">
          {mode === "percent" ? (
            <Field label="Taux (%)" htmlFor={`component-rate-${componentId}`}>
              <input
                id={`component-rate-${componentId}`}
                name="ratePercent"
                required
                inputMode="decimal"
                defaultValue={ratePercent}
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
          ) : (
            <Field label="Montant (XOF)" htmlFor={`component-amount-${componentId}`}>
              <input
                id={`component-amount-${componentId}`}
                name="amountXof"
                required
                inputMode="numeric"
                defaultValue={String(amountXof)}
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
          )}
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-[11px]">
          <input
            type="checkbox"
            name="taxable"
            defaultChecked={taxable}
            className="size-3.5 accent-brand"
          />
          Imposable
        </label>
        <button
          type="submit"
          disabled={pending}
          aria-label={`Enregistrer la rubrique ${label}`}
          title="Enregistrer"
          className={`${SUBMIT} mb-1`}
        >
          <SubmitIcon pending={pending} icon={Save} />
        </button>
      </fieldset>
    </form>
  );
}

export function PayrollComponentToggleButton({
  componentId,
  code,
  active,
}: {
  componentId: string;
  code: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setPayrollComponentActiveAction,
    EMPTY_PAYROLL_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="componentId" value={componentId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={active ? `Désactiver la rubrique ${code}` : `Réactiver la rubrique ${code}`}
        title={active ? "Désactiver" : "Réactiver"}
        className={`${SECONDARY} disabled:opacity-50`}
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

/* ------------------------------------------------------------------ paramétrage */

export function PayrollSettingsForm({
  values,
}: {
  values: {
    readonly paymentDayOfMonth: number;
    readonly socialEmployeeRate: string;
    readonly socialEmployerRate: string;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(
    savePayrollSettingsAction,
    EMPTY_PAYROLL_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage de la paie</legend>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Jour de paiement"
            htmlFor="settings-payment-day"
            hint="Jour du mois entre 1 et 31."
          >
            <input
              id="settings-payment-day"
              name="paymentDayOfMonth"
              required
              inputMode="numeric"
              defaultValue={String(values?.paymentDayOfMonth ?? 28)}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field
            label="Taux salarial"
            htmlFor="settings-employee-rate"
            hint="Cotisation salariale, pourcentage."
          >
            <input
              id="settings-employee-rate"
              name="socialEmployeeRate"
              inputMode="decimal"
              defaultValue={values?.socialEmployeeRate ?? "0"}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field
            label="Taux patronal"
            htmlFor="settings-employer-rate"
            hint="Cotisation patronale, pourcentage."
          >
            <input
              id="settings-employer-rate"
              name="socialEmployerRate"
              inputMode="decimal"
              defaultValue={values?.socialEmployerRate ?? "0"}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le paramétrage de la paie"
            title="Enregistrer"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
