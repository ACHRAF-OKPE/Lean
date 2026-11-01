import type {
  HrCalendarDay,
  HrDayPeriod,
  HrHolidayKind,
  HrTimeEntryKind,
  HrTimeEntryPeriod,
} from "@/db/schema";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  HR_DAY_PERIOD_LABELS,
  HR_HOLIDAY_KIND_LABELS,
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
  HR_WEEK_DAY_LABELS,
  HR_WEEK_DAYS,
  MAX_CALENDAR_NAME_LENGTH,
  MAX_ENTRY_HOURS,
  MAX_HOLIDAY_LABEL_LENGTH,
  MAX_TIME_ENTRY_NOTE_LENGTH,
  MIN_ENTRY_HOURS,
  isHrDayPeriod,
  isHrHolidayKind,
  isHrTimeEntryKind,
  isHrTimeEntryPeriod,
} from "./constants";
import { labelOf } from "./import-validation";
import { isValidTimeOfDay, timeToMinutes } from "./time";
import { textField, uuidField, type Field } from "./validation";

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

/** Une valeur admise soit par sa clé technique, soit par son libellé français. */
export function resolveByLabelOrKey<T extends string>(
  raw: unknown,
  labels: Record<T, string>,
): T | null {
  const text = textOf(raw);
  if (!text) {
    return null;
  }
  const keys = Object.keys(labels) as T[];
  if (keys.includes(text as T)) {
    return text as T;
  }
  const wanted = labelOf(text);
  return keys.find((key) => labelOf(labels[key]) === wanted) ?? null;
}

function timeField(raw: unknown, label: string): Field<string | null> {
  const text = textOf(raw);
  if (!text) {
    return { value: null, errors: [], warnings: [] };
  }
  if (!isValidTimeOfDay(text)) {
    return { value: null, errors: [`${label} : heure HH:MM attendue.`], warnings: [] };
  }
  return { value: text, errors: [], warnings: [] };
}

/* --------------------------------------------------------------- calendrier (HR-009) */

export interface CalendarDayInput {
  readonly dayOfWeek: HrCalendarDay;
  readonly morningFrom: string | null;
  readonly morningTo: string | null;
  readonly afternoonFrom: string | null;
  readonly afternoonTo: string | null;
  readonly sequence: number;
}

export interface CalendarInput {
  readonly name: string;
  readonly isDefault: boolean;
  readonly days: readonly CalendarDayInput[];
}

export interface CalendarDayRaw {
  readonly morningFrom?: unknown;
  readonly morningTo?: unknown;
  readonly afternoonFrom?: unknown;
  readonly afternoonTo?: unknown;
  readonly sequence?: unknown;
}

export function validateCalendarInput(raw: {
  readonly name: unknown;
  readonly isDefault?: unknown;
  readonly days?: Record<string, CalendarDayRaw> | undefined;
}): { data: CalendarInput | null; errors: string[]; warnings: string[] } {
  const name = textField(raw.name, "Nom du calendrier", {
    required: true,
    maxLength: MAX_CALENDAR_NAME_LENGTH,
  });
  const errors = [...name.errors];
  const days: CalendarDayInput[] = [];

  for (const [index, dayOfWeek] of HR_WEEK_DAYS.entries()) {
    const day = raw.days?.[dayOfWeek] ?? {};
    const label = HR_WEEK_DAY_LABELS[dayOfWeek];
    const morningFrom = timeField(day.morningFrom, `${label} matin`);
    const morningTo = timeField(day.morningTo, `${label} matin`);
    const afternoonFrom = timeField(day.afternoonFrom, `${label} après-midi`);
    const afternoonTo = timeField(day.afternoonTo, `${label} après-midi`);
    errors.push(
      ...morningFrom.errors,
      ...morningTo.errors,
      ...afternoonFrom.errors,
      ...afternoonTo.errors,
    );

    const rawSequence = textOf(day.sequence);
    const sequence = rawSequence && /^\d+$/.test(rawSequence) ? Number(rawSequence) : index + 1;
    if (sequence < 1 || sequence > 7) {
      errors.push(`${label} : rang entre 1 et 7 attendu.`);
    }

    if ((morningFrom.value === null) !== (morningTo.value === null)) {
      errors.push(`${label} : le matin demande une heure de début et une heure de fin.`);
    }
    if ((afternoonFrom.value === null) !== (afternoonTo.value === null)) {
      errors.push(`${label} : l'après-midi demande une heure de début et une heure de fin.`);
    }
    if (
      morningFrom.value &&
      morningTo.value &&
      (timeToMinutes(morningFrom.value) ?? 0) > (timeToMinutes(morningTo.value) ?? 0)
    ) {
      errors.push(`${label} : le matin se termine avant de commencer.`);
    }
    if (
      afternoonFrom.value &&
      afternoonTo.value &&
      (timeToMinutes(afternoonFrom.value) ?? 0) > (timeToMinutes(afternoonTo.value) ?? 0)
    ) {
      errors.push(`${label} : l'après-midi se termine avant de commencer.`);
    }
    if (
      morningTo.value &&
      afternoonFrom.value &&
      (timeToMinutes(morningTo.value) ?? 0) > (timeToMinutes(afternoonFrom.value) ?? 0)
    ) {
      errors.push(`${label} : l'après-midi commence avant la fin du matin.`);
    }

    days.push({
      dayOfWeek,
      morningFrom: morningFrom.value,
      morningTo: morningTo.value,
      afternoonFrom: afternoonFrom.value,
      afternoonTo: afternoonTo.value,
      sequence,
    });
  }

  if (errors.length > 0 || !name.value) {
    return { data: null, errors, warnings: [] };
  }
  return {
    data: {
      name: name.value,
      isDefault: raw.isDefault === true || raw.isDefault === "on" || raw.isDefault === "1",
      days,
    },
    errors,
    warnings: [],
  };
}

/* --------------------------------------------------------- jours fériés (HR-010) */

export interface HolidayInput {
  readonly workDate: string;
  readonly kind: HrHolidayKind;
  readonly period: HrDayPeriod;
  readonly label: string;
}

export function validateHolidayInput(raw: {
  readonly workDate: unknown;
  readonly kind: unknown;
  readonly period?: unknown;
  readonly label: unknown;
}): { data: HolidayInput | null; errors: string[]; warnings: string[] } {
  const workDate = parseIsoDate(raw.workDate, "Date du jour férié", true);
  const label = textField(raw.label, "Libellé", {
    required: true,
    maxLength: MAX_HOLIDAY_LABEL_LENGTH,
  });
  const errors = [...workDate.errors, ...label.errors];

  const kind = resolveByLabelOrKey(raw.kind, HR_HOLIDAY_KIND_LABELS);
  if (!kind || !isHrHolidayKind(kind)) {
    errors.push("Nature : Férié ou Chômé attendu.");
  }

  const periodText = textOf(raw.period);
  const period = periodText ? resolveByLabelOrKey(periodText, HR_DAY_PERIOD_LABELS) : "full";
  if (!period || !isHrDayPeriod(period)) {
    errors.push("Période : Journée, Matin ou Après-midi attendu.");
  }

  if (errors.length > 0 || !workDate.value || !label.value || !kind || !period) {
    return { data: null, errors, warnings: workDate.warnings };
  }
  return {
    data: { workDate: workDate.value, kind, period, label: label.value },
    errors,
    warnings: workDate.warnings,
  };
}

/* ------------------------------------------------------------- pointage (HR-011) */

export interface TimeEntryInput {
  readonly employeeId: string;
  readonly workDate: string;
  readonly kind: HrTimeEntryKind;
  readonly period: HrTimeEntryPeriod;
  readonly hours: string | null;
  readonly note: string | null;
}

function hoursField(raw: unknown): Field<string | null> {
  const text = textOf(raw).replace(",", ".");
  if (!text) {
    return { value: null, errors: [], warnings: [] };
  }
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) {
    return { value: null, errors: ["Heures : durée au centième attendue."], warnings: [] };
  }
  const value = Number(text);
  if (value < MIN_ENTRY_HOURS || value > MAX_ENTRY_HOURS) {
    return {
      value: null,
      errors: [`Heures : entre ${MIN_ENTRY_HOURS} et ${MAX_ENTRY_HOURS} heures attendues.`],
      warnings: [],
    };
  }
  if (Math.round(value * 4) !== value * 4) {
    return { value: null, errors: ["Heures : durée au quart d'heure près."], warnings: [] };
  }
  return { value: value.toFixed(2), errors: [], warnings: [] };
}

export function validateTimeEntryInput(raw: {
  readonly employeeId: unknown;
  readonly workDate: unknown;
  readonly kind: unknown;
  readonly period: unknown;
  readonly hours?: unknown;
  readonly note?: unknown;
}): { data: TimeEntryInput | null; errors: string[]; warnings: string[] } {
  const employee = uuidField(raw.employeeId, "Salarié", true);
  const workDate = parseIsoDate(raw.workDate, "Date du pointage", true);
  const note = textField(raw.note, "Motif", { maxLength: MAX_TIME_ENTRY_NOTE_LENGTH });
  const hours = hoursField(raw.hours);
  const errors = [...employee.errors, ...workDate.errors, ...note.errors, ...hours.errors];

  const kind = resolveByLabelOrKey(raw.kind, HR_TIME_ENTRY_KIND_LABELS);
  if (!kind || !isHrTimeEntryKind(kind)) {
    errors.push("Nature : Travaillé ou Absence attendu.");
  }

  const period = resolveByLabelOrKey(raw.period, HR_TIME_ENTRY_PERIOD_LABELS);
  if (!period || !isHrTimeEntryPeriod(period)) {
    errors.push("Période : Journée, Matin, Après-midi ou Heures attendue.");
  }

  if (period === "hours" && !hours.value) {
    errors.push("Heures : obligatoire quand la durée se saisit en heures.");
  }
  if (period && period !== "hours" && hours.value) {
    errors.push("Heures : une durée en journée, matin ou après-midi ne porte pas d'heures.");
  }
  if (kind === "absence" && !note.value) {
    errors.push("Motif : une absence explique son motif.");
  }
  if (kind === "worked" && note.value) {
    errors.push("Motif : un travaillé ne se justifie pas, gardez le motif pour les absences.");
  }

  if (errors.length > 0 || !employee.value || !workDate.value || !kind || !period) {
    return { data: null, errors, warnings: workDate.warnings };
  }
  return {
    data: {
      employeeId: employee.value,
      workDate: workDate.value,
      kind,
      period,
      hours: hours.value,
      note: note.value,
    },
    errors,
    warnings: workDate.warnings,
  };
}
