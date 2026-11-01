"use client";

import { useActionState } from "react";
import {
  Check,
  Link2,
  LoaderCircle,
  Play,
  Plus,
  Power,
  Save,
  Trash2,
  Unlink,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import {
  createContractAction,
  createDepartmentAction,
  createEmployeeAction,
  deleteContractAction,
  deleteEmployeeAction,
  linkEmployeeUserAction,
  startContractAction,
  terminateContractAction,
  toggleDepartmentActiveAction,
  unlinkEmployeeUserAction,
  updateContractAction,
  updateDepartmentAction,
  updateEmployeeAction,
} from "@/lib/hr/actions";
import { EMPTY_HR_FORM_STATE } from "@/lib/hr/form-state";
import {
  HR_CONTRACT_KINDS,
  HR_CONTRACT_KIND_LABELS,
  HR_EMPLOYEE_STATUSES,
  HR_EMPLOYEE_STATUS_LABELS,
} from "@/modules/hr/constants";
import type { HrContractKind, HrEmployeeStatus } from "@/db/schema";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";
const SMALL =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors disabled:opacity-50";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

export interface DepartmentOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface EmployeeOption {
  readonly id: string;
  readonly code: string;
  readonly fullName: string;
}

export interface DepartmentValues {
  readonly code: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly responsibleEmployeeId: string | null;
  readonly active: boolean;
}

export function DepartmentForm({
  mode,
  departmentId,
  departments,
  employees,
  department,
}: {
  mode: "create" | "edit";
  departmentId?: string;
  departments: readonly DepartmentOption[];
  employees: readonly EmployeeOption[];
  department?: DepartmentValues;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createDepartmentAction : updateDepartmentAction,
    EMPTY_HR_FORM_STATE,
  );
  const parents = departments.filter((item) => item.id !== departmentId);
  const responsibleCandidates = employees;

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && departmentId ? (
        <input type="hidden" name="departmentId" value={departmentId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau service" : "Modifier le service"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Code"
            htmlFor="department-code"
            hint="2 à 10 caractères alphanumériques, normalisé en majuscules."
          >
            <input
              id="department-code"
              name="code"
              required
              maxLength={10}
              defaultValue={department?.code ?? ""}
              placeholder="LOG"
              className={`${INPUT_CLASS} font-mono uppercase`}
            />
          </Field>

          <Field label="Nom" htmlFor="department-name" hint="80 caractères maximum.">
            <input
              id="department-name"
              name="name"
              required
              maxLength={80}
              defaultValue={department?.name ?? ""}
              placeholder="Logistique"
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Service parent"
            htmlFor="department-parent"
            hint="Facultatif. Un service ne peut pas descendre de lui-même."
          >
            <select
              id="department-parent"
              name="parentId"
              defaultValue={department?.parentId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Aucun — service racine</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Responsable"
            htmlFor="department-responsible"
            hint="Facultatif, salarié de l'espace."
          >
            <select
              id="department-responsible"
              name="responsibleEmployeeId"
              defaultValue={department?.responsibleEmployeeId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Aucun</option>
              {responsibleCandidates.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.code}
                </option>
              ))}
            </select>
          </Field>

          <div className="md:col-span-2">
            <CheckboxField
              name="active"
              label="Service actif"
              hint="Un service inactif disparaît des formulaires ; ses fiches gardent la référence."
              defaultChecked={department?.active ?? true}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          aria-label={mode === "create" ? "Créer le service" : "Enregistrer le service"}
          title={mode === "create" ? "Créer le service" : "Enregistrer"}
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
        </button>
      </fieldset>
    </form>
  );
}

export function DepartmentActiveButton({
  departmentId,
  code,
  active,
  onDetail = false,
}: {
  departmentId: string;
  code: string;
  active: boolean;
  onDetail?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    toggleDepartmentActiveAction,
    EMPTY_HR_FORM_STATE,
  );
  const label = active ? `Désactiver le service ${code}` : `Activer le service ${code}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="departmentId" value={departmentId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {onDetail ? <input type="hidden" name="detail" value="1" /> : null}
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={label}
        title={active ? "Désactiver le service" : "Activer le service"}
        className={`${SMALL} ${
          active
            ? "hover:border-copper/30 hover:text-copper"
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

export interface EmployeeValues {
  readonly code: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly position: string | null;
  readonly hireDate: string;
  readonly status: HrEmployeeStatus;
  readonly departureDate: string | null;
  readonly departmentId: string | null;
  readonly managerEmployeeId: string | null;
}

export function EmployeeForm({
  mode,
  employeeId,
  departments,
  managers,
  employee,
}: {
  mode: "create" | "edit";
  employeeId?: string;
  departments: readonly DepartmentOption[];
  managers: readonly EmployeeOption[];
  employee?: EmployeeValues;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createEmployeeAction : updateEmployeeAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && employeeId ? (
        <input type="hidden" name="employeeId" value={employeeId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouvelle fiche salarié" : "Modifier la fiche salarié"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Matricule"
            htmlFor="employee-code"
            hint="1 à 16 caractères, unique dans l'espace, normalisé en majuscules."
          >
            <input
              id="employee-code"
              name="code"
              required
              maxLength={16}
              defaultValue={employee?.code ?? ""}
              placeholder="EMP0001"
              className={`${INPUT_CLASS} font-mono uppercase`}
            />
          </Field>

          <Field label="Poste" htmlFor="employee-position" hint="Facultatif, 80 caractères.">
            <input
              id="employee-position"
              name="position"
              maxLength={80}
              defaultValue={employee?.position ?? ""}
              placeholder="Responsable logistique"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Nom" htmlFor="employee-lastName" hint="60 caractères maximum.">
            <input
              id="employee-lastName"
              name="lastName"
              required
              maxLength={60}
              defaultValue={employee?.lastName ?? ""}
              placeholder="DIALLO"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Prénom" htmlFor="employee-firstName" hint="60 caractères maximum.">
            <input
              id="employee-firstName"
              name="firstName"
              required
              maxLength={60}
              defaultValue={employee?.firstName ?? ""}
              placeholder="Aminata"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Date d'embauche" htmlFor="employee-hireDate" hint="AAAA-MM-JJ.">
            <input
              id="employee-hireDate"
              name="hireDate"
              type="date"
              required
              defaultValue={employee?.hireDate ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Statut" htmlFor="employee-status" hint="Actif par défaut.">
            <select
              id="employee-status"
              name="status"
              defaultValue={employee?.status ?? "active"}
              className={INPUT_CLASS}
            >
              {HR_EMPLOYEE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HR_EMPLOYEE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Date de sortie"
            htmlFor="employee-departureDate"
            hint="Obligatoire pour un salarié sorti, postérieure à l'embauche."
          >
            <input
              id="employee-departureDate"
              name="departureDate"
              type="date"
              defaultValue={employee?.departureDate ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Service"
            htmlFor="employee-department"
            hint="Seuls les services actifs sont proposés."
          >
            <select
              id="employee-department"
              name="departmentId"
              defaultValue={employee?.departmentId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Aucun service</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} · {department.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Manager"
              htmlFor="employee-manager"
              hint="Salarié de l'espace, actif, différent de lui-même."
            >
              <select
                id="employee-manager"
                name="managerEmployeeId"
                defaultValue={employee?.managerEmployeeId ?? ""}
                className={INPUT_CLASS}
              >
                <option value="">Aucun manager</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.fullName} · {manager.code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          aria-label={mode === "create" ? "Créer la fiche salarié" : "Enregistrer la fiche salarié"}
          title={mode === "create" ? "Créer la fiche" : "Enregistrer"}
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
        </button>
      </fieldset>
    </form>
  );
}

export interface MemberOption {
  readonly userId: string;
  readonly label: string;
}

/** HR-003 — le rattachement relie la fiche à un compte membre ; il ne change aucun droit. */
export function LinkAccountForm({
  employeeId,
  members,
  currentUserId,
}: {
  employeeId: string;
  members: readonly MemberOption[];
  currentUserId: string | null;
}) {
  const [state, formAction, pending] = useActionState(linkEmployeeUserAction, EMPTY_HR_FORM_STATE);
  const available = members.filter((member) => member.userId !== currentUserId);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        <legend className="sr-only">Rattacher un compte membre</legend>
        <Field
          label="Compte membre"
          htmlFor="link-user"
          hint="Compte membre de l'espace ; un compte déjà rattaché à une autre fiche est refusé."
        >
          <select id="link-user" name="userId" required className={INPUT_CLASS}>
            <option value="" disabled>
              Sélectionner un compte
            </option>
            {available.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          disabled={pending || available.length === 0}
          aria-label="Rattacher ce compte à la fiche"
          title="Rattacher le compte"
          className={`${SUBMIT} disabled:opacity-40`}
        >
          <SubmitIcon pending={pending} icon={Link2} />
        </button>
      </fieldset>
    </form>
  );
}

export function UnlinkAccountButton({ employeeId, code }: { employeeId: string; code: string }) {
  const [state, formAction, pending] = useActionState(
    unlinkEmployeeUserAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Détacher le compte de la fiche ${code}`}
        title="Détacher le compte"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Unlink className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function DeleteEmployeeButton({
  employeeId,
  code,
  fullName,
}: {
  employeeId: string;
  code: string;
  fullName: string;
}) {
  const [state, formAction, pending] = useActionState(deleteEmployeeAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="employeeId" value={employeeId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-80">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer la fiche ${code} — ${fullName}`}
        title="Supprimer la fiche (sans contrat)"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <UserRoundX className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export interface ContractValues {
  readonly employeeId: string;
  readonly kind: HrContractKind;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly trialPeriodDays: number;
  readonly weeklyHours: string;
  readonly salaryXof: number;
}

export function ContractForm({
  mode,
  contractId,
  employees,
  contract,
  locked,
}: {
  mode: "create" | "edit";
  contractId?: string;
  employees: readonly EmployeeOption[];
  contract?: ContractValues;
  locked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createContractAction : updateContractAction,
    EMPTY_HR_FORM_STATE,
  );

  if (locked) {
    return (
      <p className="text-[11px] leading-5 text-muted">
        Contrat sorti du brouillon : ses dates, son type, sa durée et son salaire sont figés. Une
        correction passe par une résiliation puis un nouveau contrat.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && contractId ? (
        <input type="hidden" name="contractId" value={contractId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau contrat de travail" : "Modifier le contrat"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Salarié" htmlFor="contract-employee" hint="Fiche de l'espace.">
            <select
              id="contract-employee"
              name="employeeId"
              required
              defaultValue={contract?.employeeId ?? ""}
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
            label="Type"
            htmlFor="contract-kind"
            hint="CDD, intérim et stage exigent une date de fin."
          >
            <select
              id="contract-kind"
              name="kind"
              defaultValue={contract?.kind ?? "cdi"}
              className={INPUT_CLASS}
            >
              {HR_CONTRACT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {HR_CONTRACT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date de début" htmlFor="contract-start" hint="AAAA-MM-JJ.">
            <input
              id="contract-start"
              name="startDate"
              type="date"
              required
              defaultValue={contract?.startDate ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Date de fin"
            htmlFor="contract-end"
            hint="Facultative pour un CDI ou une mission."
          >
            <input
              id="contract-end"
              name="endDate"
              type="date"
              defaultValue={contract?.endDate ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Période d'essai"
            htmlFor="contract-trial"
            hint="Jours entiers, 365 maximum, jamais plus que la durée du contrat."
          >
            <input
              id="contract-trial"
              name="trialPeriodDays"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={contract?.trialPeriodDays ?? 0}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>

          <Field
            label="Durée hebdomadaire"
            htmlFor="contract-hours"
            hint="Heures, 80 maximum, ex. 40 ou 37.5."
          >
            <input
              id="contract-hours"
              name="weeklyHours"
              inputMode="decimal"
              defaultValue={contract?.weeklyHours ?? "40"}
              placeholder="40"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Salaire brut"
              htmlFor="contract-salary"
              hint="Entier en XOF. Donnée sensible : jamais listée, exportée ni tracée dans l'audit."
            >
              <input
                id="contract-salary"
                name="salaryXof"
                inputMode="numeric"
                defaultValue={contract ? String(contract.salaryXof) : ""}
                placeholder="250000"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </Field>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          aria-label={
            mode === "create" ? "Créer le contrat en brouillon" : "Enregistrer le contrat"
          }
          title={mode === "create" ? "Créer le brouillon" : "Enregistrer"}
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
        </button>
      </fieldset>
    </form>
  );
}

export function StartContractButton({ contractId, label }: { contractId: string; label: string }) {
  const [state, formAction, pending] = useActionState(startContractAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="contractId" value={contractId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Mettre en cours le contrat ${label}`}
        title="Sortir du brouillon (gestion requise)"
        className={SUBMIT}
      >
        <SubmitIcon pending={pending} icon={Play} />
      </button>
    </form>
  );
}

export function TerminateContractForm({
  contractId,
  label,
  startDate,
  today,
}: {
  contractId: string;
  label: string;
  startDate: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(terminateContractAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="contractId" value={contractId} />
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        <legend className="sr-only">Résilier le contrat</legend>
        <Field
          label="Date de résiliation"
          htmlFor="terminated-on"
          hint="Postérieure ou égale au début du contrat."
        >
          <input
            id="terminated-on"
            name="terminatedOn"
            type="date"
            required
            min={startDate}
            defaultValue={today}
            className={INPUT_CLASS}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label={`Résilier le contrat ${label}`}
          title="Résilier (gestion requise)"
          className={SECONDARY}
        >
          <SubmitIcon pending={pending} icon={Check} />
        </button>
      </fieldset>
    </form>
  );
}

export function DeleteContractButton({ contractId, label }: { contractId: string; label: string }) {
  const [state, formAction, pending] = useActionState(deleteContractAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="contractId" value={contractId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le brouillon de contrat ${label}`}
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
