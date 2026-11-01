import type { HrContractKind, HrContractStatus, HrEmployeeStatus } from "@/db/schema";
import {
  DEPARTMENT_CODE_PATTERN,
  EMPLOYEE_CODE_PATTERN,
  MAX_DEPARTMENT_NAME_LENGTH,
  MAX_PERSON_NAME_LENGTH,
  MAX_POSITION_LENGTH,
  MAX_TRIAL_DAYS,
  MAX_WEEKLY_HOURS,
  isFixedTerm,
  isHrContractKind,
  isHrEmployeeStatus,
  type HrContractDisplayStatus,
} from "./constants";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import { compareQuantity, parseQuantity } from "@/modules/stock/quantities";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Field<T> {
  readonly value: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function uuidField(raw: unknown, label: string, required = false): Field<string | null> {
  const value = textOf(raw);
  if (!value) {
    return { value: null, errors: required ? [`${label} : obligatoire.`] : [], warnings: [] };
  }
  if (!UUID_PATTERN.test(value)) {
    return { value: null, errors: [`${label} : référence invalide.`], warnings: [] };
  }
  return { value, errors: [], warnings: [] };
}

export function textField(
  raw: unknown,
  label: string,
  options: { required?: boolean; maxLength: number },
): Field<string | null> {
  const value = textOf(raw);
  if (!value) {
    return {
      value: null,
      errors: options.required ? [`${label} : obligatoire.`] : [],
      warnings: [],
    };
  }
  if (value.length > options.maxLength) {
    return {
      value: null,
      errors: [`${label} : ${options.maxLength} caractères maximum.`],
      warnings: [],
    };
  }
  return { value, errors: [], warnings: [] };
}

export function normalizeDepartmentCode(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const code = text.replace(/[\s\u00a0\u202f]/g, "").toUpperCase();
  if (!code) {
    return { value: null, errors: ["Code du service : obligatoire."], warnings: [] };
  }
  const warnings: string[] = code === text ? [] : ["Code du service : normalisé en majuscules."];
  if (!DEPARTMENT_CODE_PATTERN.test(code)) {
    return {
      value: null,
      errors: ["Code du service : 2 à 10 caractères alphanumériques attendu."],
      warnings,
    };
  }
  return { value: code, errors: [], warnings };
}

export function normalizeEmployeeCode(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const code = text.replace(/[\s\u00a0\u202f]/g, "").toUpperCase();
  if (!code) {
    return { value: null, errors: ["Matricule : obligatoire."], warnings: [] };
  }
  const warnings: string[] = code === text ? [] : ["Matricule : normalisé en majuscules."];
  if (!EMPLOYEE_CODE_PATTERN.test(code)) {
    return {
      value: null,
      errors: ["Matricule : 1 à 16 caractères alphanumériques attendu."],
      warnings,
    };
  }
  return { value: code, errors: [], warnings };
}

function trialDaysField(raw: unknown, label: string): Field<number> {
  const text = textOf(raw);
  if (!text) {
    return { value: 0, errors: [], warnings: [] };
  }
  if (!/^\d+$/.test(text)) {
    return { value: 0, errors: [`${label} : nombre de jours entiers attendu.`], warnings: [] };
  }
  const value = Number(text);
  if (value > MAX_TRIAL_DAYS) {
    return {
      value: 0,
      errors: [`${label} : ${MAX_TRIAL_DAYS} jours maximum.`],
      warnings: [],
    };
  }
  return { value, errors: [], warnings: [] };
}

function weeklyHoursField(raw: unknown, label: string): Field<string> {
  const text = textOf(raw);
  if (!text) {
    return { value: "0", errors: [], warnings: [] };
  }
  const parsed = parseQuantity(text, label, { allowZero: true });
  if (parsed.value === null) {
    return { value: "0", errors: parsed.errors, warnings: parsed.warnings };
  }
  if (compareQuantity(parsed.value, MAX_WEEKLY_HOURS) > 0) {
    return {
      value: "0",
      errors: [`${label} : ${MAX_WEEKLY_HOURS} heures maximum.`],
      warnings: parsed.warnings,
    };
  }
  return { value: parsed.value, errors: [], warnings: parsed.warnings };
}

export function isActive(raw: unknown, fallback = true): boolean {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  return raw !== false && raw !== "false" && raw !== "off" && raw !== "0";
}

export function daySpan(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function addIsoDays(isoDate: string, days: number): string {
  const base = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

export interface DepartmentInput {
  readonly code: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly responsibleEmployeeId: string | null;
  readonly active: boolean;
}

export function validateDepartmentInput(raw: {
  readonly code: unknown;
  readonly name: unknown;
  readonly parentId?: unknown;
  readonly responsibleEmployeeId?: unknown;
  readonly active?: unknown;
}): { data: DepartmentInput | null; errors: string[]; warnings: string[] } {
  const code = normalizeDepartmentCode(raw.code);
  const name = textField(raw.name, "Nom du service", {
    required: true,
    maxLength: MAX_DEPARTMENT_NAME_LENGTH,
  });
  const parent = uuidField(raw.parentId, "Service parent");
  const responsible = uuidField(raw.responsibleEmployeeId, "Responsable du service");
  const errors = [...code.errors, ...name.errors, ...parent.errors, ...responsible.errors];
  const warnings = [...code.warnings];

  if (errors.length > 0 || !code.value || !name.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      code: code.value,
      name: name.value,
      parentId: parent.value,
      responsibleEmployeeId: responsible.value,
      active: isActive(raw.active),
    },
    errors,
    warnings,
  };
}

export interface EmployeeInput {
  readonly code: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly position: string | null;
  readonly hireDate: string;
  readonly status: HrEmployeeStatus;
  readonly departureDate: string | null;
  readonly departmentId: string | null;
  readonly managerEmployeeId: string | null;
  readonly workCalendarId: string | null;
}

export function validateEmployeeInput(raw: {
  readonly code: unknown;
  readonly lastName: unknown;
  readonly firstName: unknown;
  readonly position?: unknown;
  readonly hireDate: unknown;
  readonly status?: unknown;
  readonly departureDate?: unknown;
  readonly departmentId?: unknown;
  readonly managerEmployeeId?: unknown;
  readonly workCalendarId?: unknown;
  readonly employeeId?: unknown;
}): { data: EmployeeInput | null; errors: string[]; warnings: string[] } {
  const code = normalizeEmployeeCode(raw.code);
  const lastName = textField(raw.lastName, "Nom", {
    required: true,
    maxLength: MAX_PERSON_NAME_LENGTH,
  });
  const firstName = textField(raw.firstName, "Prénom", {
    required: true,
    maxLength: MAX_PERSON_NAME_LENGTH,
  });
  const position = textField(raw.position, "Poste", { maxLength: MAX_POSITION_LENGTH });
  const hireDate = parseIsoDate(raw.hireDate, "Date d'embauche", true);
  const departureDate = parseIsoDate(raw.departureDate, "Date de sortie");
  const department = uuidField(raw.departmentId, "Service");
  const manager = uuidField(raw.managerEmployeeId, "Manager");
  const calendar = uuidField(raw.workCalendarId, "Calendrier de travail");
  const self = uuidField(raw.employeeId, "Fiche modifiée");

  const statusText = textOf(raw.status) || "active";
  const errors = [
    ...code.errors,
    ...lastName.errors,
    ...firstName.errors,
    ...position.errors,
    ...hireDate.errors,
    ...departureDate.errors,
    ...department.errors,
    ...manager.errors,
    ...calendar.errors,
    ...self.errors,
  ];
  const warnings = [...code.warnings, ...hireDate.warnings, ...departureDate.warnings];

  if (!isHrEmployeeStatus(statusText)) {
    errors.push("Statut : valeur inconnue.");
  }
  const status = isHrEmployeeStatus(statusText) ? statusText : "active";

  if (status === "left") {
    if (!departureDate.value) {
      errors.push("Date de sortie : obligatoire pour un salarié sorti.");
    } else if (hireDate.value && departureDate.value <= hireDate.value) {
      errors.push("Date de sortie : doit être postérieure à la date d'embauche.");
    }
  } else if (departureDate.value) {
    errors.push("Date de sortie : un salarié actif ou suspendu ne porte pas de date de sortie.");
  }

  if (manager.value && self.value && manager.value === self.value) {
    errors.push("Manager : un salarié ne peut pas être son propre manager.");
  }

  if (errors.length > 0 || !code.value || !lastName.value || !firstName.value || !hireDate.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      code: code.value,
      lastName: lastName.value,
      firstName: firstName.value,
      position: position.value,
      hireDate: hireDate.value,
      status,
      departureDate: departureDate.value,
      departmentId: department.value,
      managerEmployeeId: manager.value,
      workCalendarId: calendar.value,
    },
    errors,
    warnings,
  };
}

export interface ContractInput {
  readonly employeeId: string;
  readonly kind: HrContractKind;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly trialPeriodDays: number;
  readonly weeklyHours: string;
  readonly salaryXof: number;
}

export function validateContractInput(raw: {
  readonly employeeId: unknown;
  readonly kind: unknown;
  readonly startDate: unknown;
  readonly endDate?: unknown;
  readonly trialPeriodDays?: unknown;
  readonly weeklyHours?: unknown;
  readonly salaryXof?: unknown;
}): { data: ContractInput | null; errors: string[]; warnings: string[] } {
  const employee = uuidField(raw.employeeId, "Salarié", true);
  const kindText = textOf(raw.kind);
  const startDate = parseIsoDate(raw.startDate, "Date de début", true);
  const endDate = parseIsoDate(raw.endDate, "Date de fin");
  const trial = trialDaysField(raw.trialPeriodDays, "Période d'essai");
  const hours = weeklyHoursField(raw.weeklyHours, "Durée hebdomadaire");
  const salaryText = textOf(raw.salaryXof);
  const salary = salaryText
    ? parseXofPrice(salaryText, "Salaire brut")
    : { value: 0, errors: [], warnings: [] };

  const errors = [
    ...employee.errors,
    ...startDate.errors,
    ...endDate.errors,
    ...trial.errors,
    ...hours.errors,
    ...salary.errors,
  ];
  const warnings = [
    ...startDate.warnings,
    ...endDate.warnings,
    ...hours.warnings,
    ...salary.warnings,
  ];

  if (!isHrContractKind(kindText)) {
    errors.push("Type de contrat : valeur inconnue.");
  }
  const kind = isHrContractKind(kindText) ? kindText : "cdi";

  if (isFixedTerm(kind) && !endDate.value) {
    errors.push("Date de fin : obligatoire pour un CDD, un intérim ou un stage.");
  }
  if (startDate.value && endDate.value) {
    if (endDate.value <= startDate.value) {
      errors.push("Date de fin : doit être postérieure à la date de début.");
    } else if (trial.value > daySpan(startDate.value, endDate.value)) {
      errors.push("Période d'essai : ne peut dépasser la durée du contrat.");
    }
  }

  if (errors.length > 0 || !employee.value || !startDate.value || !isHrContractKind(kindText)) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      employeeId: employee.value,
      kind,
      startDate: startDate.value,
      endDate: endDate.value,
      trialPeriodDays: trial.value,
      weeklyHours: hours.value,
      salaryXof: salary.value,
    },
    errors,
    warnings,
  };
}

/** HR-004 — « éché » est dérivé à la lecture, jamais stocké. */
export function contractDisplayStatus(input: {
  readonly status: HrContractStatus;
  readonly endDate: string | null;
  readonly today: string;
}): HrContractDisplayStatus {
  if (input.status !== "running" || !input.endDate) {
    return input.status;
  }
  return input.endDate < input.today ? "expired" : "running";
}

export function trialDeadline(startDate: string, trialPeriodDays: number): string | null {
  return trialPeriodDays > 0 ? addIsoDays(startDate, trialPeriodDays) : null;
}

export function employeeFullName(lastName: string, firstName: string): string {
  return `${lastName.toUpperCase()} ${firstName}`;
}
