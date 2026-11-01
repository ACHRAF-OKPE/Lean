import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrEmployees,
  hrPublicHolidays,
  hrTimeEntries,
  hrWorkCalendarDays,
  hrWorkCalendars,
  importRows,
  type HrCalendarDay,
  type HrDayPeriod,
  type HrTimeEntryPeriod,
  type HrTimeEntryStatus,
} from "@/db/schema";
import type { RawImportRow, ValidationContext } from "@/modules/catalog/validation";
import { todayIsoDate } from "@/lib/dates";
import { HrError } from "./errors";
import { normalizeEmployeeCode } from "./validation";
import { entryCapacityErrors } from "./time-queries";
import { timeFromColumn, type CalendarDayBounds } from "./time";
import { validateTimeEntryInput, type TimeEntryInput } from "./time-validation";
import type { CalendarDaysByWeekDay, HrTimeEntryImportData } from "./time-import-validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

export interface ApplyHrTimeEntryImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function boundsOf(row: {
  readonly morningFrom: string | null;
  readonly morningTo: string | null;
  readonly afternoonFrom: string | null;
  readonly afternoonTo: string | null;
}): CalendarDayBounds {
  return {
    morningFrom: timeFromColumn(row.morningFrom),
    morningTo: timeFromColumn(row.morningTo),
    afternoonFrom: timeFromColumn(row.afternoonFrom),
    afternoonTo: timeFromColumn(row.afternoonTo),
  };
}

/** Les valeurs du fichier qui désignent un matricule et une date, pour borner les requêtes. */
function fileKeys(rows: readonly RawImportRow[]): {
  codes: readonly string[];
  dates: readonly string[];
} {
  const codes = new Set<string>();
  const dates = new Set<string>();
  for (const row of rows) {
    const code = normalizeEmployeeCode(row.values["matricule"]).value;
    if (code) {
      codes.add(code);
    }
    const date = String(row.values["date"] ?? "").trim();
    if (ISO_DATE_PATTERN.test(date)) {
      dates.add(date);
    }
  }
  return { codes: [...codes], dates: [...dates] };
}

/** HR-012 — ce que l'analyse consulte sans écrire : fiches, calendriers, jours fériés, pointages posés. */
export async function loadHrTimeImportContext(
  db: Database,
  tenantId: string,
  rows: readonly RawImportRow[],
): Promise<Partial<ValidationContext>> {
  const { codes, dates } = fileKeys(rows);

  const employeeRows =
    codes.length === 0
      ? []
      : await db
          .select({
            id: hrEmployees.id,
            code: hrEmployees.code,
            status: hrEmployees.status,
            workCalendarId: hrEmployees.workCalendarId,
          })
          .from(hrEmployees)
          .where(and(eq(hrEmployees.tenantId, tenantId), inArray(hrEmployees.code, codes)));

  const [calendarRows, dayRows] = await Promise.all([
    db
      .select({ id: hrWorkCalendars.id, isDefault: hrWorkCalendars.isDefault })
      .from(hrWorkCalendars)
      .where(eq(hrWorkCalendars.tenantId, tenantId)),
    db
      .select({
        calendarId: hrWorkCalendarDays.calendarId,
        dayOfWeek: hrWorkCalendarDays.dayOfWeek,
        morningFrom: hrWorkCalendarDays.morningFrom,
        morningTo: hrWorkCalendarDays.morningTo,
        afternoonFrom: hrWorkCalendarDays.afternoonFrom,
        afternoonTo: hrWorkCalendarDays.afternoonTo,
      })
      .from(hrWorkCalendarDays)
      .innerJoin(hrWorkCalendars, eq(hrWorkCalendarDays.calendarId, hrWorkCalendars.id))
      .where(eq(hrWorkCalendars.tenantId, tenantId)),
  ]);

  const calendars = new Map<string, CalendarDaysByWeekDay>();
  const daysByCalendar = new Map<string, Map<HrCalendarDay, CalendarDayBounds>>();
  for (const row of dayRows) {
    const map = daysByCalendar.get(row.calendarId) ?? new Map<HrCalendarDay, CalendarDayBounds>();
    map.set(row.dayOfWeek as HrCalendarDay, boundsOf(row));
    daysByCalendar.set(row.calendarId, map);
  }
  for (const calendar of calendarRows) {
    calendars.set(calendar.id, daysByCalendar.get(calendar.id) ?? new Map());
  }

  const holidayRows =
    dates.length === 0
      ? []
      : await db
          .select({ workDate: hrPublicHolidays.workDate, period: hrPublicHolidays.period })
          .from(hrPublicHolidays)
          .where(
            and(
              eq(hrPublicHolidays.tenantId, tenantId),
              inArray(hrPublicHolidays.workDate, [...dates].sort()),
            ),
          );
  const holidaysByDate = new Map<string, HrDayPeriod[]>();
  for (const row of holidayRows) {
    const list = holidaysByDate.get(row.workDate) ?? [];
    list.push(row.period as HrDayPeriod);
    holidaysByDate.set(row.workDate, list);
  }

  const entryRows =
    employeeRows.length === 0 || dates.length === 0
      ? []
      : await db
          .select({
            id: hrTimeEntries.id,
            employeeId: hrTimeEntries.employeeId,
            workDate: hrTimeEntries.workDate,
            period: hrTimeEntries.period,
            hours: hrTimeEntries.hours,
            status: hrTimeEntries.status,
          })
          .from(hrTimeEntries)
          .where(
            and(
              eq(hrTimeEntries.tenantId, tenantId),
              inArray(
                hrTimeEntries.employeeId,
                employeeRows.map((row) => row.id),
              ),
              inArray(hrTimeEntries.workDate, [...dates].sort()),
            ),
          );

  const existing = new Map<
    string,
    { id: string; period: HrTimeEntryPeriod; hours: string | null; status: HrTimeEntryStatus }[]
  >();
  for (const row of entryRows) {
    const key = `${row.employeeId}|${row.workDate}`;
    const list = existing.get(key) ?? [];
    list.push({
      id: row.id,
      period: row.period as HrTimeEntryPeriod,
      hours: row.hours,
      status: row.status as HrTimeEntryStatus,
    });
    existing.set(key, list);
  }

  return {
    hrTimeEmployeesByCode: new Map(
      employeeRows.map((row) => [
        row.code,
        { id: row.id, code: row.code, status: row.status, workCalendarId: row.workCalendarId },
      ]),
    ),
    hrTimeCalendarDays: calendars,
    hrTimeDefaultCalendarId: calendarRows.find((row) => row.isDefault)?.id ?? null,
    hrTimeHolidaysByDate: holidaysByDate,
    hrTimeExistingEntries: existing,
    hrTimeToday: todayIsoDate(),
  };
}

function dataOf(row: StoredRow): HrTimeEntryImportData {
  return row.data as unknown as HrTimeEntryImportData;
}

/**
 * HR-012 — écriture des pointages applicables : chaque ligne re-vérifiée contre la base au moment
 * de confirmer, insérée en brouillon dans l'ordre du fichier, les lignes du fichier se cumulant.
 * Une ligne annoncée sur un brouillon de même période met ce brouillon à jour au lieu d'en créer
 * un second ; un validé en face bloque le lot.
 */
export async function applyHrTimeEntryImport(
  tx: Transaction,
  input: ApplyHrTimeEntryImportInput,
): Promise<{ written: number; updated: number }> {
  if (input.rows.length === 0) {
    throw new HrError("Aucun pointage applicable dans cet import.");
  }

  const codes = [...new Set(input.rows.map((row) => dataOf(row).code).filter(Boolean))];
  const employeeRows =
    codes.length === 0
      ? []
      : await tx
          .select({ id: hrEmployees.id, code: hrEmployees.code, status: hrEmployees.status })
          .from(hrEmployees)
          .where(and(eq(hrEmployees.tenantId, input.tenantId), inArray(hrEmployees.code, codes)));
  const employeesByCode = new Map(employeeRows.map((row) => [row.code, row]));

  const created: { rowNumber: number; id: string; code: string; workDate: string }[] = [];
  let replaced = 0;
  for (const row of input.rows) {
    const data = dataOf(row);
    const employee = employeesByCode.get(data.code);
    if (!employee) {
      throw new HrError(
        `Ligne ${row.rowNumber} : salarié indisponible. Relancez l'analyse avant de confirmer.`,
      );
    }
    if (employee.status === "left") {
      throw new HrError(`Ligne ${row.rowNumber} : ce salarié est sorti de l'effectif.`);
    }

    const validated = validateTimeEntryInput({
      employeeId: employee.id,
      workDate: data.workDate,
      kind: data.kind,
      period: data.period,
      hours: data.hours,
      note: data.note,
    });
    if (!validated.data) {
      throw new HrError(
        `Ligne ${row.rowNumber} : ${validated.errors[0] ?? "pointage invalide. Relancez l'analyse avant de confirmer."}`,
      );
    }
    const entry: TimeEntryInput = validated.data;
    let reusedId: string | null = null;

    if (entry.period !== "hours") {
      const [overlap] = await tx
        .select({ id: hrTimeEntries.id, status: hrTimeEntries.status })
        .from(hrTimeEntries)
        .where(
          and(
            eq(hrTimeEntries.tenantId, input.tenantId),
            eq(hrTimeEntries.employeeId, employee.id),
            eq(hrTimeEntries.workDate, entry.workDate),
            eq(hrTimeEntries.period, entry.period),
          ),
        )
        .limit(1);
      if (overlap) {
        if (overlap.status === "validated" || overlap.id !== data.updateId) {
          throw new HrError(
            `Ligne ${row.rowNumber} : ce salarié porte déjà un pointage ${
              overlap.status === "validated" ? "validé" : "brouillon"
            } pour cette période du jour. Relancez l'analyse avant de confirmer.`,
          );
        }
        replaced += 1;
        reusedId = overlap.id;
      }
    }

    const capacityErrors = await entryCapacityErrors(tx, input.tenantId, entry, reusedId);
    if (capacityErrors[0]) {
      throw new HrError(`Ligne ${row.rowNumber} : ${capacityErrors[0]}`);
    }

    let entryId: string;
    if (reusedId) {
      await tx
        .update(hrTimeEntries)
        .set({ kind: entry.kind, hours: entry.hours, note: entry.note, updatedAt: new Date() })
        .where(and(eq(hrTimeEntries.tenantId, input.tenantId), eq(hrTimeEntries.id, reusedId)));
      entryId = reusedId;
    } else {
      const [createdRow] = await tx
        .insert(hrTimeEntries)
        .values({
          tenantId: input.tenantId,
          employeeId: employee.id,
          workDate: entry.workDate,
          kind: entry.kind,
          period: entry.period,
          hours: entry.hours,
          note: entry.note,
          status: "draft",
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrTimeEntries.id });
      if (!createdRow) {
        throw new HrError(`Ligne ${row.rowNumber} : le pointage n'a pas pu être créé.`);
      }
      entryId = createdRow.id;
    }
    created.push({
      rowNumber: row.rowNumber,
      id: entryId,
      code: employee.code,
      workDate: entry.workDate,
    });
  }

  const written = created.length;
  const updated = replaced;

  for (const row of created) {
    await tx
      .update(importRows)
      .set({ entityId: row.id })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          eq(importRows.rowNumber, row.rowNumber),
        ),
      );
  }

  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "hr.time_entry.import",
    entityType: "import_batch",
    entityId: input.batchId,
    details: {
      source: "import",
      written,
      updated,
      employeeCodes: [...new Set(created.map((row) => row.code))].sort(),
      dates: [...new Set(created.map((row) => row.workDate))].sort(),
    },
  });

  return { written, updated };
}
