import type { HrLeaveHalfDay } from "@/db/schema";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  HR_LEAVE_HALF_DAY_LABELS,
  LEAVE_TYPE_CODE_PATTERN,
  MAX_ANNUAL_ALLOWANCE_DAYS,
  MAX_LEAVE_REASON_LENGTH,
  MAX_LEAVE_TYPE_NAME_LENGTH,
  isHrLeaveHalfDay,
} from "./constants";
import { isLeaveRangeValid } from "./leave";
import { resolveByLabelOrKey } from "./time-validation";
import { isActive, textField, uuidField, type Field } from "./validation";

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

/* ------------------------------------------------------------- types de congés (HR-013) */

export interface LeaveTypeInput {
  readonly code: string;
  readonly name: string;
  readonly paid: boolean;
  readonly halfDayAllowed: boolean;
  readonly annualAllowanceDays: string;
  readonly active: boolean;
}

export function normalizeLeaveTypeCode(raw: unknown): Field<string | null> {
  const text = textOf(raw);
  const code = text.replace(/[\s\u00a0\u202f]/g, "").toUpperCase();
  if (!code) {
    return { value: null, errors: ["Code du type de congé : obligatoire."], warnings: [] };
  }
  const warnings: string[] =
    code === text ? [] : ["Code du type de congé : normalisé en majuscules."];
  if (!LEAVE_TYPE_CODE_PATTERN.test(code)) {
    return {
      value: null,
      errors: ["Code du type de congé : 2 à 12 caractères alphanumériques attendu."],
      warnings,
    };
  }
  return { value: code, errors: [], warnings };
}

function allowanceField(raw: unknown): Field<string> {
  const text = textOf(raw).replace(",", ".");
  if (!text) {
    return { value: "0", errors: [], warnings: [] };
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    return {
      value: "0",
      errors: ["Droit annuel : nombre de jours au centième attendu."],
      warnings: [],
    };
  }
  const value = Number(text);
  if (value < 0 || value > MAX_ANNUAL_ALLOWANCE_DAYS) {
    return {
      value: "0",
      errors: [`Droit annuel : entre 0 et ${MAX_ANNUAL_ALLOWANCE_DAYS} jours attendus.`],
      warnings: [],
    };
  }
  return { value: value.toFixed(2), errors: [], warnings: [] };
}

export function validateLeaveTypeInput(raw: {
  readonly code: unknown;
  readonly name: unknown;
  readonly paid?: unknown;
  readonly halfDayAllowed?: unknown;
  readonly annualAllowanceDays?: unknown;
  readonly active?: unknown;
}): { data: LeaveTypeInput | null; errors: string[]; warnings: string[] } {
  const code = normalizeLeaveTypeCode(raw.code);
  const name = textField(raw.name, "Nom du type de congé", {
    required: true,
    maxLength: MAX_LEAVE_TYPE_NAME_LENGTH,
  });
  const allowance = allowanceField(raw.annualAllowanceDays);
  const errors = [...code.errors, ...name.errors, ...allowance.errors];
  const warnings = [...code.warnings];

  if (errors.length > 0 || !code.value || !name.value) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      code: code.value,
      name: name.value,
      paid: isActive(raw.paid),
      halfDayAllowed: isActive(raw.halfDayAllowed),
      annualAllowanceDays: allowance.value,
      active: isActive(raw.active),
    },
    errors,
    warnings,
  };
}

/* ----------------------------------------------------------- demandes de congé (HR-014) */

export interface LeaveRequestInput {
  readonly employeeId: string;
  readonly leaveTypeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: HrLeaveHalfDay;
  readonly endHalfDay: HrLeaveHalfDay;
  readonly reason: string | null;
}

export function validateLeaveRequestInput(raw: {
  readonly employeeId: unknown;
  readonly leaveTypeId: unknown;
  readonly startDate: unknown;
  readonly endDate: unknown;
  readonly startHalfDay: unknown;
  readonly endHalfDay: unknown;
  readonly reason?: unknown;
}): { data: LeaveRequestInput | null; errors: string[]; warnings: string[] } {
  const employee = uuidField(raw.employeeId, "Salarié", true);
  const leaveType = uuidField(raw.leaveTypeId, "Type de congé", true);
  const startDate = parseIsoDate(raw.startDate, "Date de début", true);
  const endDate = parseIsoDate(raw.endDate, "Date de fin", true);
  const reason = textField(raw.reason, "Motif", { maxLength: MAX_LEAVE_REASON_LENGTH });
  const errors = [
    ...employee.errors,
    ...leaveType.errors,
    ...startDate.errors,
    ...endDate.errors,
    ...reason.errors,
  ];
  const warnings = [...startDate.warnings, ...endDate.warnings];

  const startHalfDay = resolveByLabelOrKey(raw.startHalfDay, HR_LEAVE_HALF_DAY_LABELS);
  if (!startHalfDay || !isHrLeaveHalfDay(startHalfDay)) {
    errors.push("Début : Matin ou Après-midi attendu.");
  }
  const endHalfDay = resolveByLabelOrKey(raw.endHalfDay, HR_LEAVE_HALF_DAY_LABELS);
  if (!endHalfDay || !isHrLeaveHalfDay(endHalfDay)) {
    errors.push("Fin : Matin ou Après-midi attendu.");
  }

  if (
    startDate.value &&
    endDate.value &&
    startHalfDay &&
    endHalfDay &&
    isHrLeaveHalfDay(startHalfDay) &&
    isHrLeaveHalfDay(endHalfDay) &&
    !isLeaveRangeValid({
      startDate: startDate.value,
      endDate: endDate.value,
      startHalfDay,
      endHalfDay,
    })
  ) {
    errors.push(
      "Période : la date de fin précède le début, ou une demande d'un seul jour qui démarre l'après-midi ne se termine pas le matin.",
    );
  }

  if (
    errors.length > 0 ||
    !employee.value ||
    !leaveType.value ||
    !startDate.value ||
    !endDate.value ||
    !isHrLeaveHalfDay(startHalfDay ?? "") ||
    !isHrLeaveHalfDay(endHalfDay ?? "")
  ) {
    return { data: null, errors, warnings };
  }
  return {
    data: {
      employeeId: employee.value,
      leaveTypeId: leaveType.value,
      startDate: startDate.value,
      endDate: endDate.value,
      startHalfDay: startHalfDay as HrLeaveHalfDay,
      endHalfDay: endHalfDay as HrLeaveHalfDay,
      reason: reason.value,
    },
    errors,
    warnings,
  };
}
