"use client";

import { useActionState, useState } from "react";
import { Ban, Check, LoaderCircle, Plus, Save, Trash2, X, type LucideIcon } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import type { EmployeeOption } from "@/components/hr-forms";
import {
  createLeaveRequestAction,
  createLeaveTypeAction,
  deleteLeaveRequestAction,
  deleteLeaveTypeAction,
  setLeaveRequestStatusAction,
  updateLeaveRequestAction,
  updateLeaveTypeAction,
} from "@/lib/hr/leave-actions";
import { EMPTY_HR_FORM_STATE } from "@/lib/hr/form-state";
import {
  HR_LEAVE_HALF_DAY_LABELS,
  HR_LEAVE_HALF_DAYS,
  MAX_ANNUAL_ALLOWANCE_DAYS,
  MAX_LEAVE_DECISION_NOTE_LENGTH,
  MAX_LEAVE_REASON_LENGTH,
  MAX_LEAVE_TYPE_NAME_LENGTH,
} from "@/modules/hr/constants";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SMALL =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors disabled:opacity-50";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

/* ------------------------------------------------------------- types de congés */

export interface LeaveTypeValues {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly paid: boolean;
  readonly halfDayAllowed: boolean;
  readonly annualAllowanceDays: string;
  readonly active: boolean;
}

export function LeaveTypeForm({
  mode,
  leaveTypeId,
  leaveType,
}: {
  mode: "create" | "edit";
  leaveTypeId?: string;
  leaveType?: LeaveTypeValues;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createLeaveTypeAction : updateLeaveTypeAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && leaveTypeId ? (
        <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau type de congé" : "Modifier le type de congé"}
        </legend>

        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Code"
            htmlFor="leave-type-code"
            hint="2 à 12 caractères, majuscules, chiffres, point, tiret ou souligné."
          >
            <input
              id="leave-type-code"
              name="code"
              required
              maxLength={12}
              defaultValue={leaveType?.code ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Nom" htmlFor="leave-type-name" hint="Ex. Congé annuel payé.">
            <input
              id="leave-type-name"
              name="name"
              required
              maxLength={MAX_LEAVE_TYPE_NAME_LENGTH}
              defaultValue={leaveType?.name ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Droit annuel (jours)"
            htmlFor="leave-type-allowance"
            hint={`Au centième, entre 0 et ${MAX_ANNUAL_ALLOWANCE_DAYS} jours. Sert au solde.`}
          >
            <input
              id="leave-type-allowance"
              name="annualAllowanceDays"
              inputMode="decimal"
              defaultValue={leaveType?.annualAllowanceDays ?? "0"}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="grid gap-1 md:grid-cols-3">
          <CheckboxField
            name="paid"
            label="Congé payé"
            hint="Le salaire reste dû sur la période."
            defaultChecked={leaveType?.paid ?? true}
          />
          <CheckboxField
            name="halfDayAllowed"
            label="Demi-journée autorisée"
            hint="Une demande peut se poser le matin ou l'après-midi."
            defaultChecked={leaveType?.halfDayAllowed ?? true}
          />
          <CheckboxField
            name="active"
            label="Type actif"
            hint="Seuls les types actifs acceptent de nouvelles demandes."
            defaultChecked={leaveType?.active ?? true}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label={
              mode === "create" ? "Enregistrer le type de congé" : "Enregistrer les modifications"
            }
            title={
              mode === "create" ? "Enregistrer le type de congé" : "Enregistrer les modifications"
            }
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function DeleteLeaveTypeButton({
  leaveTypeId,
  label,
}: {
  leaveTypeId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(deleteLeaveTypeAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le type de congé ${label}`}
        title="Supprimer le type (aucune demande ne doit y être rattachée)"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* ----------------------------------------------------------- demandes de congé */

export interface LeaveRequestValues {
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: string;
  readonly endHalfDay: string;
  readonly reason: string;
}

export function LeaveRequestForm({
  mode,
  requestId,
  request,
  employees,
  leaveTypes,
  today,
}: {
  mode: "create" | "edit";
  requestId?: string;
  request?: LeaveRequestValues;
  employees: readonly EmployeeOption[];
  leaveTypes: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createLeaveRequestAction : updateLeaveRequestAction,
    EMPTY_HR_FORM_STATE,
  );
  const [startDate, setStartDate] = useState(request?.startDate ?? today);
  const [endDate, setEndDate] = useState(request?.endDate ?? request?.startDate ?? today);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && requestId ? (
        <input type="hidden" name="requestId" value={requestId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouvelle demande de congé" : "Modifier la demande de congé"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Salarié" htmlFor="leave-employee" hint="Fiche active de l'espace.">
            <select
              id="leave-employee"
              name="employeeId"
              required
              defaultValue={request?.employeeId ?? employees[0]?.id ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un salarié
              </option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.code}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Type de congé"
            htmlFor="leave-type"
            hint="Seuls les types actifs acceptent une demande."
          >
            <select
              id="leave-type"
              name="leaveTypeId"
              required
              defaultValue={request?.leaveTypeId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un type
              </option>
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} · {type.code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Du" htmlFor="leave-start" hint="AAAA-MM-JJ.">
            <input
              id="leave-start"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                if (value && (!endDate || endDate < value)) {
                  setEndDate(value);
                }
              }}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Début" htmlFor="leave-start-half" hint="La journée ou une demi-journée.">
            <select
              id="leave-start-half"
              name="startHalfDay"
              defaultValue={request?.startHalfDay ?? "morning"}
              className={INPUT_CLASS}
            >
              {HR_LEAVE_HALF_DAYS.map((half) => (
                <option key={half} value={half}>
                  {HR_LEAVE_HALF_DAY_LABELS[half]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Au" htmlFor="leave-end" hint="Jamais avant le début.">
            <input
              id="leave-end"
              name="endDate"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Fin" htmlFor="leave-end-half" hint="La journée ou une demi-journée.">
            <select
              id="leave-end-half"
              name="endHalfDay"
              defaultValue={request?.endHalfDay ?? "afternoon"}
              className={INPUT_CLASS}
            >
              {HR_LEAVE_HALF_DAYS.map((half) => (
                <option key={half} value={half}>
                  {HR_LEAVE_HALF_DAY_LABELS[half]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Motif"
          htmlFor="leave-reason"
          hint={`Facultatif, ${MAX_LEAVE_REASON_LENGTH} caractères maximum.`}
        >
          <input
            id="leave-reason"
            name="reason"
            maxLength={MAX_LEAVE_REASON_LENGTH}
            defaultValue={request?.reason ?? ""}
            className={INPUT_CLASS}
          />
        </Field>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label={
              mode === "create" ? "Enregistrer la demande" : "Enregistrer les modifications"
            }
            title={mode === "create" ? "Enregistrer la demande" : "Enregistrer les modifications"}
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function StatusButton({
  requestId,
  status,
  decisionNote,
  label,
  title,
  icon: Icon,
  className,
}: {
  requestId: string;
  status: "validated" | "refused" | "cancelled";
  decisionNote?: string;
  label: string;
  title: string;
  icon: LucideIcon;
  className: string;
}) {
  const [state, formAction, pending] = useActionState(
    setLeaveRequestStatusAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="status" value={status} />
      {decisionNote ? <input type="hidden" name="decisionNote" value={decisionNote} /> : null}
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={label}
        title={title}
        className={`${SMALL} ${className}`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function ValidateLeaveRequestButton({
  requestId,
  label,
}: {
  requestId: string;
  label: string;
}) {
  return (
    <StatusButton
      requestId={requestId}
      status="validated"
      label={`Valider la demande ${label}`}
      title="Valider (gestion requise)"
      icon={Check}
      className="hover:border-brand/30 hover:text-brand"
    />
  );
}

export function CancelLeaveRequestButton({
  requestId,
  label,
}: {
  requestId: string;
  label: string;
}) {
  return (
    <StatusButton
      requestId={requestId}
      status="cancelled"
      label={`Annuler la demande ${label}`}
      title="Annuler (gestion requise)"
      icon={Ban}
      className="hover:border-copper/30 hover:text-copper"
    />
  );
}

/** HR-013 — un refus porte son motif : le champ accompagne le bouton. */
export function RefuseLeaveRequestForm({ requestId, label }: { requestId: string; label: string }) {
  const [state, formAction, pending] = useActionState(
    setLeaveRequestStatusAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex items-start gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="status" value="refused" />
      <input
        name="decisionNote"
        required
        maxLength={MAX_LEAVE_DECISION_NOTE_LENGTH}
        placeholder="Motif du refus"
        aria-label={`Motif du refus de la demande ${label}`}
        className="w-48 rounded-md border border-line bg-panel px-2 py-1 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
      />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Refuser la demande ${label}`}
        title="Refuser (motif obligatoire, gestion requise)"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-3.5" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <div className="max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </form>
  );
}

export function DeleteLeaveRequestButton({
  requestId,
  label,
}: {
  requestId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteLeaveRequestAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="requestId" value={requestId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer la demande ${label}`}
        title="Supprimer le brouillon"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
