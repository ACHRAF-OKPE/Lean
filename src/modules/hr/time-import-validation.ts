import type {
  HrCalendarDay,
  HrDayPeriod,
  HrTimeEntryKind,
  HrTimeEntryPeriod,
  HrTimeEntryStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate } from "@/modules/shared/validation";
import type {
  RawImportRow,
  ValidatedRow,
  ValidationContext,
  ValidationResult,
} from "@/modules/catalog/validation";
import {
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
  HR_WEEK_DAY_LABELS,
} from "./constants";
import {
  availableHalfDays,
  availableHours,
  entryHalfDays,
  entryHours,
  formatHalfDays,
  formatHours,
  isPeriodAvailable,
  weekDayOf,
  type CalendarDayBounds,
  type EntryTotals,
} from "./time";
import { resolveByLabelOrKey, validateTimeEntryInput } from "./time-validation";
import { normalizeEmployeeCode } from "./validation";

const EMPTY_BOUNDS: CalendarDayBounds = {
  morningFrom: null,
  morningTo: null,
  afternoonFrom: null,
  afternoonTo: null,
};

/** Le calendrier applicable d'un salarié, par jour de semaine. */
export type CalendarDaysByWeekDay = ReadonlyMap<HrCalendarDay, CalendarDayBounds>;

export interface HrTimeEmployeeReference {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly workCalendarId: string | null;
}

export interface HrExistingTimeEntry {
  readonly id: string;
  readonly period: HrTimeEntryPeriod;
  readonly hours: string | null;
  readonly status: HrTimeEntryStatus;
}

export interface HrTimeEntryImportData {
  code: string;
  workDate: string;
  kind: HrTimeEntryKind;
  period: HrTimeEntryPeriod;
  hours: string | null;
  note: string | null;
  employeeId: string | null;
  updateId: string | null;
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function dayKey(employeeId: string, workDate: string): string {
  return `${employeeId}|${workDate}`;
}

function totalsOf(entries: readonly HrExistingTimeEntry[]): EntryTotals {
  let halfDays = 0;
  let hours = 0;
  for (const entry of entries) {
    halfDays += entryHalfDays(entry.period);
    hours += entryHours(entry.period, entry.hours);
  }
  return { halfDays, hours };
}

/**
 * HR-012 — analyse d'un fichier de pointages : le matricule et la date désignent la fiche et le
 * jour, la capacité du calendrier applicable — celui de la fiche sinon celui de l'espace, jours
 * fériés et chômés déduits — borne la saisie, et les lignes du fichier se cumulent aux pointages
 * déjà enregistrés. Une ligne posée sur un brouillon de même période est un avertissement : elle
 * met ce brouillon à jour au lieu d'en doubler un second. Un validé en face bloque la ligne.
 * L'analyse n'écrit rien.
 */
export function validateHrTimeEntryImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
): ValidationResult {
  const employees = context.hrTimeEmployeesByCode ?? new Map<string, HrTimeEmployeeReference>();
  const calendars = context.hrTimeCalendarDays ?? new Map<string, CalendarDaysByWeekDay>();
  const defaultCalendarId = context.hrTimeDefaultCalendarId ?? null;
  const holidays = context.hrTimeHolidaysByDate ?? new Map<string, readonly HrDayPeriod[]>();
  const existing =
    context.hrTimeExistingEntries ?? new Map<string, readonly HrExistingTimeEntry[]>();
  const today = context.hrTimeToday ?? todayIsoDate();

  const consumed = new Map<string, EntryTotals>();
  const entriesByDay = new Map<string, readonly HrExistingTimeEntry[]>();
  const fileStamps = new Set<string>();
  for (const [key, entries] of existing) {
    consumed.set(key, totalsOf(entries));
    entriesByDay.set(key, entries);
  }

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const code = normalizeEmployeeCode(row.values["matricule"]);
    errors.push(...code.errors);
    warnings.push(...code.warnings);

    const employee = code.value ? (employees.get(code.value) ?? null) : null;
    if (code.value && !employee) {
      errors.push(`Matricule ${code.value} : aucun salarié de cet espace ne le porte.`);
    } else if (employee?.status === "left") {
      errors.push(`Matricule ${employee.code} : ce salarié est sorti de l'effectif.`);
    }

    const workDate = parseIsoDate(row.values["date"], "Date", true);
    errors.push(...workDate.errors);
    warnings.push(...workDate.warnings);
    if (workDate.value && workDate.value > today) {
      errors.push(`Date : un pointage ne se saisit pas pour un jour futur (${today}).`);
    }

    const natureText = textOf(row.values["nature"]);
    const kind = resolveByLabelOrKey(natureText || "worked", HR_TIME_ENTRY_KIND_LABELS);
    if (!natureText) {
      warnings.push("Nature : vide, « Travaillé » retenu.");
    } else if (!kind) {
      errors.push("Nature : Travaillé ou Absence attendu.");
    }

    const periodText = textOf(row.values["periode"]);
    const period = resolveByLabelOrKey(periodText, HR_TIME_ENTRY_PERIOD_LABELS);
    if (!periodText) {
      errors.push("Période : obligatoire — Journée, Matin, Après-midi ou Heures.");
    } else if (!period) {
      errors.push("Période : Journée, Matin, Après-midi ou Heures attendue.");
    }

    let data: HrTimeEntryImportData | null = null;

    if (errors.length === 0 && employee && workDate.value && kind && period) {
      const entry = validateTimeEntryInput({
        employeeId: employee.id,
        workDate: workDate.value,
        kind,
        period,
        hours: row.values["heures"],
        note: row.values["motif"],
      });
      errors.push(...entry.errors);
      warnings.push(...entry.warnings);

      if (entry.data) {
        const bounds = calendars
          .get(employee.workCalendarId ?? defaultCalendarId ?? "")
          ?.get(weekDayOf(entry.data.workDate));
        const dayHolidays = holidays.get(entry.data.workDate) ?? [];
        const key = dayKey(employee.id, entry.data.workDate);
        let updateId: string | null = null;
        if (entry.data.period !== "hours") {
          const overlap = (entriesByDay.get(key) ?? []).find((record) => record.period === period);
          if (overlap) {
            if (overlap.status === "validated") {
              errors.push(
                `${entry.data.workDate} : le pointage de cette période est déjà validé. Repasse-le au brouillon depuis sa fiche pour le reprendre.`,
              );
            } else {
              updateId = overlap.id;
              warnings.push(
                `${entry.data.workDate} : la ligne reprend le pointage brouillon de cette période et le met à jour, sans le dupliquer.`,
              );
            }
          }
        }
        const dayTotals = consumed.get(key) ?? { halfDays: 0, hours: 0 };
        const taken = {
          halfDays: dayTotals.halfDays - (updateId ? entryHalfDays(entry.data.period) : 0),
          hours: dayTotals.hours,
        };

        if (!employee.workCalendarId && !defaultCalendarId) {
          errors.push(
            "Calendrier applicable : la fiche ne porte aucun calendrier et l'espace n'en a pas défini.",
          );
        }

        if (entry.data.period === "hours") {
          const capacity = availableHours(bounds ?? EMPTY_BOUNDS, dayHolidays);
          const hours = taken.hours + entryHours("hours", entry.data.hours);
          if (capacity <= 0) {
            errors.push(
              `${entry.data.workDate} : ce jour ne compte aucune heure travaillée au calendrier applicable (jours fériés déduits).`,
            );
          } else if (hours - capacity > 0.001) {
            errors.push(
              `${entry.data.workDate} : ${formatHours(hours)} heures dépassent les ${formatHours(
                capacity,
              )} heures que compte ce jour.`,
            );
          }
        } else {
          const stamp = `${key}|${entry.data.period}`;
          if (fileStamps.has(stamp)) {
            errors.push(
              `${entry.data.workDate} : le fichier porte deux lignes pour ce salarié, ce jour et cette période.`,
            );
          }
          fileStamps.add(stamp);

          if (!isPeriodAvailable(bounds ?? EMPTY_BOUNDS, dayHolidays, entry.data.period)) {
            const label = HR_WEEK_DAY_LABELS[weekDayOf(entry.data.workDate)];
            errors.push(
              `${entry.data.workDate} (${label}) : demi-journée non travaillée au calendrier applicable, ou couverte par un jour férié ou chômé.`,
            );
          } else {
            const capacity = availableHalfDays(bounds ?? EMPTY_BOUNDS, dayHolidays);
            const halfDays = taken.halfDays + entryHalfDays(entry.data.period);
            if (halfDays - capacity > 0.001) {
              errors.push(
                `${entry.data.workDate} : ${formatHalfDays(halfDays)} demi-journée(s) dépassent ${formatHalfDays(
                  capacity,
                )} que compte ce jour.`,
              );
            }
          }
        }

        consumed.set(key, {
          halfDays: taken.halfDays + entryHalfDays(entry.data.period),
          hours: taken.hours + entryHours("hours", entry.data.hours),
        });

        data = {
          code: employee.code,
          workDate: entry.data.workDate,
          kind: entry.data.kind,
          period: entry.data.period,
          hours: entry.data.hours,
          note: entry.data.note,
          employeeId: employee.id,
          updateId,
        };
      }
    }

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: employee?.code ?? code.value ?? null,
      errors,
      warnings,
      data: {
        ...(data ??
          ({
            code: employee?.code ?? code.value ?? "",
            workDate: workDate.value ?? textOf(row.values["date"]),
            kind: kind ?? "worked",
            period: period ?? "full",
            hours: null,
            note: textOf(row.values["motif"]) || null,
            employeeId: employee?.id ?? null,
            updateId: null,
          } satisfies HrTimeEntryImportData)),
      },
    };
  });

  for (const row of validated) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }

  const notes: string[] = [];
  const applicable = validated.filter((row) => row.errors.length === 0);
  const updates = applicable.filter(
    (row) => (row.data as unknown as HrTimeEntryImportData).updateId,
  ).length;
  if (applicable.length > 0) {
    const detail =
      updates === 0
        ? "en brouillon"
        : `en brouillon, dont ${updates} sur un brouillon déjà posé, sans duplication`;
    notes.push(
      `${applicable.length} pointage${applicable.length > 1 ? "s" : ""} seront écrits ${detail} à la confirmation : la validation reste une décision séparée.`,
    );
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}
