import type { HrCalendarDay, HrDayPeriod, HrTimeEntryPeriod } from "@/db/schema";
import { TIME_OF_DAY_PATTERN } from "./constants";

/** HR-009 — les bornes horaires d'un jour de calendrier, en « HH:MM ». */
export interface CalendarDayBounds {
  readonly morningFrom: string | null;
  readonly morningTo: string | null;
  readonly afternoonFrom: string | null;
  readonly afternoonTo: string | null;
}

const HALF_DAY_UNIT = 2;

/** Ce qu'un jour de travail a déjà consommé, en demi-journées et en heures. */
export interface EntryTotals {
  readonly halfDays: number;
  readonly hours: number;
}

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

/** L'heure lue en base porte ses secondes (« HH:MM:SS ») ; les calculs travaillent en « HH:MM ». */
export function timeFromColumn(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

export function timeToMinutes(value: string): number | null {
  if (!isValidTimeOfDay(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function isSet(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isMorningWorked(bounds: CalendarDayBounds): boolean {
  return isSet(bounds.morningFrom) && isSet(bounds.morningTo);
}

export function isAfternoonWorked(bounds: CalendarDayBounds): boolean {
  return isSet(bounds.afternoonFrom) && isSet(bounds.afternoonTo);
}

/** HR-009 — valeur travaillée du jour en demi-journées entières (0, 1 ou 2 unités). */
export function workedHalfDayUnits(bounds: CalendarDayBounds): number {
  return (isMorningWorked(bounds) ? 1 : 0) + (isAfternoonWorked(bounds) ? 1 : 0);
}

/** HR-009 — valeur travaillée du jour en demi-journées : 0, 0,5 ou 1. */
export function workedHalfDays(bounds: CalendarDayBounds): number {
  return workedHalfDayUnits(bounds) / HALF_DAY_UNIT;
}

export function workedMinutes(bounds: CalendarDayBounds): number {
  let minutes = 0;
  if (isMorningWorked(bounds)) {
    minutes += minuteSpan(bounds.morningFrom, bounds.morningTo);
  }
  if (isAfternoonWorked(bounds)) {
    minutes += minuteSpan(bounds.afternoonFrom, bounds.afternoonTo);
  }
  return minutes;
}

function minuteSpan(from: string | null, to: string | null): number {
  if (!isSet(from) || !isSet(to)) {
    return 0;
  }
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start === null || end === null) {
    return 0;
  }
  return Math.max(0, end - start);
}

/** HR-010 — fraction non travaillée posée par un jour férié ou chômé, en unités de demi-journée. */
export function holidayHalfDayUnits(bounds: CalendarDayBounds, period: HrDayPeriod): number {
  if (period === "full") {
    return workedHalfDayUnits(bounds);
  }
  if (period === "morning") {
    return isMorningWorked(bounds) ? 1 : 0;
  }
  return isAfternoonWorked(bounds) ? 1 : 0;
}

export function holidayMinutes(bounds: CalendarDayBounds, period: HrDayPeriod): number {
  if (period === "full") {
    return workedMinutes(bounds);
  }
  if (period === "morning") {
    return isMorningWorked(bounds) ? minuteSpan(bounds.morningFrom, bounds.morningTo) : 0;
  }
  return isAfternoonWorked(bounds) ? minuteSpan(bounds.afternoonFrom, bounds.afternoonTo) : 0;
}

/** HR-009 + HR-010 : valeur travaillée du jour en demi-journées, jours fériés et chômés déduits. */
export function availableHalfDayUnits(
  bounds: CalendarDayBounds,
  holidays: readonly HrDayPeriod[],
): number {
  let units = workedHalfDayUnits(bounds);
  for (const period of holidays) {
    units -= holidayHalfDayUnits(bounds, period);
  }
  return Math.max(0, units);
}

/** HR-009 + HR-010 : la même valeur exprimée en journées, jamais négative. */
export function availableHalfDays(
  bounds: CalendarDayBounds,
  holidays: readonly HrDayPeriod[],
): number {
  return availableHalfDayUnits(bounds, holidays) / HALF_DAY_UNIT;
}

/** HR-009 + HR-010 — capacité horaire du jour, fractions fériées déduites, arrondie au centième. */
export function availableHours(
  bounds: CalendarDayBounds,
  holidays: readonly HrDayPeriod[],
): number {
  let minutes = workedMinutes(bounds);
  for (const period of holidays) {
    minutes -= holidayMinutes(bounds, period);
  }
  return minutesToHours(Math.max(0, minutes));
}

/** HR-011 — durée d'un pointage exprimé en période, en demi-journées ; les heures valent 0. */
export function entryHalfDays(period: HrTimeEntryPeriod): number {
  if (period === "full") {
    return 1;
  }
  return period === "morning" || period === "afternoon" ? 0.5 : 0;
}

/** HR-011 — les heures d'un pointage ; une saisie en période ne consomme pas de capacité horaire. */
export function entryHours(period: HrTimeEntryPeriod, hours: string | number | null): number {
  if (period !== "hours" || hours === null || hours === "") {
    return 0;
  }
  return typeof hours === "number" ? hours : Number(hours);
}

/** HR-011 — la période saisie trouve-t-elle une demi-journée travaillée non fériée ce jour-là ? */
export function isPeriodAvailable(
  bounds: CalendarDayBounds,
  holidays: readonly HrDayPeriod[],
  period: Exclude<HrTimeEntryPeriod, "hours">,
): boolean {
  const halves: readonly ("morning" | "afternoon")[] =
    period === "full" ? ["morning", "afternoon"] : [period];
  return halves.every((half) => {
    const worked = half === "morning" ? isMorningWorked(bounds) : isAfternoonWorked(bounds);
    return worked && !holidays.includes("full") && !holidays.includes(half);
  });
}

const WEEK_DAY_BY_ISO_INDEX: readonly HrCalendarDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function weekDayOf(isoDate: string): HrCalendarDay {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return WEEK_DAY_BY_ISO_INDEX[(parsed.getUTCDay() + 6) % 7] ?? "monday";
}

export interface CalendarDayOrder {
  readonly dayOfWeek: HrCalendarDay;
  readonly sequence: number;
}

/** HR-009 — premier jour de la semaine : le rang le plus faible, lundi à défaut. */
export function firstWeekDay(days: readonly CalendarDayOrder[]): HrCalendarDay {
  let best: CalendarDayOrder | null = null;
  for (const day of days) {
    if (!best || day.sequence < best.sequence) {
      best = day;
    }
  }
  return best?.dayOfWeek ?? "monday";
}

export function formatHalfDays(value: number): string {
  return Number.isInteger(value) ? String(value) : `${value}`.replace(".", ",");
}

export function formatHours(value: number): string {
  return `${Math.round(value * 100) / 100}`.replace(".", ",");
}
