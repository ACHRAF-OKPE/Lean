import type { HrDayPeriod, HrLeaveHalfDay } from "@/db/schema";
import { addIsoDays } from "./validation";
import { availableHalfDayUnits, availableHours, type CalendarDayBounds } from "./time";

/**
 * HR-014 — une demande de congé couvre des demi-journées bornées par un début et une fin :
 * « matin » au départ démarre la journée entière, « après-midi » à l'arrivée la termine.
 * Le couple (début, fin) décrit donc la première et la dernière journée couvertes ; une demande
 * d'un seul jour se réduit à l'intersection des deux.
 */
export interface LeaveRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: HrLeaveHalfDay;
  readonly endHalfDay: HrLeaveHalfDay;
}

const FULL_DAY_HALVES: readonly HrLeaveHalfDay[] = ["morning", "afternoon"];

/** HR-014 — un départ l'après-midi ne se termine pas le matin du même jour. */
export function isLeaveRangeValid(range: LeaveRange): boolean {
  if (range.endDate < range.startDate) {
    return false;
  }
  if (range.endDate > range.startDate) {
    return true;
  }
  return range.startHalfDay === "morning" || range.endHalfDay === "afternoon";
}

/** HR-014 — les demi-journées du jour `date` couvertes par la demande. */
export function leaveCoveredHalves(date: string, range: LeaveRange): readonly HrLeaveHalfDay[] {
  if (date < range.startDate || date > range.endDate) {
    return [];
  }
  if (range.startDate === range.endDate) {
    return FULL_DAY_HALVES.filter(
      (half) =>
        !(half === "morning" && range.startHalfDay === "afternoon") &&
        !(half === "afternoon" && range.endHalfDay === "morning"),
    );
  }
  if (date === range.startDate) {
    return range.startHalfDay === "morning" ? FULL_DAY_HALVES : ["afternoon"];
  }
  if (date === range.endDate) {
    return range.endHalfDay === "afternoon" ? FULL_DAY_HALVES : ["morning"];
  }
  return FULL_DAY_HALVES;
}

/** HR-014 — la même couverture exprimée en périodes, pour la déduire comme un jour férié. */
export function leaveCoveredPeriods(date: string, range: LeaveRange): readonly HrDayPeriod[] {
  const halves = leaveCoveredHalves(date, range);
  if (halves.length === 0) {
    return [];
  }
  if (halves.length === 2) {
    return ["full"];
  }
  return [halves[0] as HrDayPeriod];
}

export interface LeaveDayCapacity {
  readonly date: string;
  readonly bounds: CalendarDayBounds;
  readonly holidays: readonly HrDayPeriod[];
}

/** HR-014 : ce que la demande retire du travail attendu un jour donné, en demi-journées. */
export function leaveDayHalfDays(
  capacity: LeaveDayCapacity,
  covered: readonly HrDayPeriod[],
): number {
  if (covered.length === 0) {
    return 0;
  }
  const expected = availableHalfDayUnits(capacity.bounds, capacity.holidays);
  const remaining = availableHalfDayUnits(capacity.bounds, [...capacity.holidays, ...covered]);
  return Math.max(0, expected - remaining);
}

export function leaveDayHours(capacity: LeaveDayCapacity, covered: readonly HrDayPeriod[]): number {
  if (covered.length === 0) {
    return 0;
  }
  const expected = availableHours(capacity.bounds, capacity.holidays);
  const remaining = availableHours(capacity.bounds, [...capacity.holidays, ...covered]);
  return Math.max(0, expected - remaining);
}

export interface LeaveTotals {
  readonly halfDays: number;
  readonly hours: number;
  readonly days: number;
}

/** HR-014 — les demi-journées et heures qu'une demande retire au calendrier applicable. */
export function leaveRequestTotals(
  range: LeaveRange,
  capacities: readonly LeaveDayCapacity[],
): LeaveTotals {
  let halfDays = 0;
  let hours = 0;
  let days = 0;
  for (const capacity of capacities) {
    const covered = leaveCoveredPeriods(capacity.date, range);
    if (covered.length === 0) {
      continue;
    }
    const dayHalfDays = leaveDayHalfDays(capacity, covered);
    if (dayHalfDays > 0) {
      days += 1;
    }
    halfDays += dayHalfDays;
    hours += leaveDayHours(capacity, covered);
  }
  return {
    halfDays: Math.round(halfDays * 2) / 2,
    hours: Math.round(hours * 100) / 100,
    days,
  };
}

/** HR-014 — chaque date de la plage, du début à la fin inclus. */
export function leaveDates(range: LeaveRange): readonly string[] {
  const dates: string[] = [];
  for (let date = range.startDate; date <= range.endDate; date = addIsoDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** HR-015 — deux demandes du même salarié se chevauchent-elles sur au moins une demi-journée ? */
export function leaveRangesOverlap(
  employeeId: string,
  otherEmployeeId: string,
  first: LeaveRange,
  second: LeaveRange,
): boolean {
  if (employeeId !== otherEmployeeId) {
    return false;
  }
  const from = first.startDate > second.startDate ? first.startDate : second.startDate;
  const to = first.endDate < second.endDate ? first.endDate : second.endDate;
  for (let date = from; date <= to; date = addIsoDays(date, 1)) {
    const left = leaveCoveredHalves(date, first);
    const right = leaveCoveredHalves(date, second);
    if (left.some((half) => right.includes(half))) {
      return true;
    }
  }
  return false;
}
