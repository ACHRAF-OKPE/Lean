import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrEmployees,
  hrPublicHolidays,
  hrTimeEntries,
  hrWorkCalendarDays,
  hrWorkCalendars,
  type HrCalendarDay,
  type HrDayPeriod,
  type HrTimeEntryStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { HR_LIST_LIMIT, HR_WEEK_DAY_LABELS } from "./constants";
import { HrError } from "./errors";
import {
  availableHalfDays,
  availableHours,
  entryHalfDays,
  entryHours,
  firstWeekDay,
  formatHalfDays,
  formatHours,
  isPeriodAvailable,
  timeFromColumn,
  weekDayOf,
  type CalendarDayBounds,
  type EntryTotals,
} from "./time";
import {
  validateCalendarInput,
  validateHolidayInput,
  validateTimeEntryInput,
  type CalendarInput,
  type TimeEntryInput,
} from "./time-validation";
import { addIsoDays, employeeFullName } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Transaction;

const EMPTY_BOUNDS: CalendarDayBounds = {
  morningFrom: null,
  morningTo: null,
  afternoonFrom: null,
  afternoonTo: null,
};

function assertValid<T>(
  result: { data: T | null; errors: readonly string[] },
  fallback: string,
): T {
  if (!result.data || result.errors.length > 0) {
    throw new HrError(result.errors[0] ?? fallback);
  }
  return result.data;
}

function rethrow(message: string): never {
  throw new HrError(message);
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/* -------------------------------------------------------------- calendriers (HR-009) */

export interface WorkCalendarSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly weeklyHalfDays: number;
  readonly weeklyHours: number;
  readonly attachedEmployees: number;
}

export interface WorkCalendarDay {
  readonly dayOfWeek: HrCalendarDay;
  readonly morningFrom: string | null;
  readonly morningTo: string | null;
  readonly afternoonFrom: string | null;
  readonly afternoonTo: string | null;
  readonly sequence: number;
}

export interface WorkCalendarDetail extends WorkCalendarSummary {
  readonly days: readonly WorkCalendarDay[];
  readonly firstDayOfWeek: HrCalendarDay;
}

interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

async function loadCalendarDays(
  db: DbLike,
  tenantId: string,
  calendarIds: readonly string[],
): Promise<Map<string, WorkCalendarDay[]>> {
  const byCalendar = new Map<string, WorkCalendarDay[]>();
  if (calendarIds.length === 0) {
    return byCalendar;
  }
  const rows = await db
    .select({
      calendarId: hrWorkCalendarDays.calendarId,
      dayOfWeek: hrWorkCalendarDays.dayOfWeek,
      morningFrom: hrWorkCalendarDays.morningFrom,
      morningTo: hrWorkCalendarDays.morningTo,
      afternoonFrom: hrWorkCalendarDays.afternoonFrom,
      afternoonTo: hrWorkCalendarDays.afternoonTo,
      sequence: hrWorkCalendarDays.sequence,
    })
    .from(hrWorkCalendarDays)
    .where(
      and(
        eq(hrWorkCalendarDays.tenantId, tenantId),
        inArray(hrWorkCalendarDays.calendarId, [...calendarIds]),
      ),
    )
    .orderBy(asc(hrWorkCalendarDays.sequence));

  for (const row of rows) {
    const days = byCalendar.get(row.calendarId) ?? [];
    days.push({
      dayOfWeek: row.dayOfWeek,
      morningFrom: timeFromColumn(row.morningFrom),
      morningTo: timeFromColumn(row.morningTo),
      afternoonFrom: timeFromColumn(row.afternoonFrom),
      afternoonTo: timeFromColumn(row.afternoonTo),
      sequence: row.sequence,
    });
    byCalendar.set(row.calendarId, days);
  }
  return byCalendar;
}

function boundsOfDay(day: WorkCalendarDay | undefined): CalendarDayBounds {
  return day ?? EMPTY_BOUNDS;
}

function weekTotals(days: readonly WorkCalendarDay[]): {
  halfDays: number;
  hours: number;
} {
  let halfDays = 0;
  let hours = 0;
  for (const day of days) {
    halfDays += availableHalfDays(boundsOfDay(day), []);
    hours += availableHours(boundsOfDay(day), []);
  }
  return { halfDays: Math.round(halfDays * 2) / 2, hours: Math.round(hours * 100) / 100 };
}

export async function listWorkCalendars(
  db: Database,
  tenantId: string,
): Promise<readonly WorkCalendarSummary[]> {
  const [calendars, attached] = await Promise.all([
    db
      .select({
        id: hrWorkCalendars.id,
        name: hrWorkCalendars.name,
        isDefault: hrWorkCalendars.isDefault,
      })
      .from(hrWorkCalendars)
      .where(eq(hrWorkCalendars.tenantId, tenantId))
      .orderBy(desc(hrWorkCalendars.isDefault), asc(hrWorkCalendars.name)),
    db
      .select({ calendarId: hrEmployees.workCalendarId, total: count() })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, tenantId), isNotNull(hrEmployees.workCalendarId)))
      .groupBy(hrEmployees.workCalendarId),
  ]);

  const daysByCalendar = await loadCalendarDays(
    db,
    tenantId,
    calendars.map((calendar) => calendar.id),
  );
  const attachedByCalendar = new Map(
    attached.map((row) => [row.calendarId as string, Number(row.total)]),
  );

  return calendars.map((calendar) => {
    const days = daysByCalendar.get(calendar.id) ?? [];
    const totals = weekTotals(days);
    return {
      id: calendar.id,
      name: calendar.name,
      isDefault: calendar.isDefault,
      weeklyHalfDays: totals.halfDays,
      weeklyHours: totals.hours,
      attachedEmployees: attachedByCalendar.get(calendar.id) ?? 0,
    };
  });
}

export async function getWorkCalendar(
  db: Database,
  tenantId: string,
  calendarId: string,
): Promise<WorkCalendarDetail | null> {
  const [calendar] = await db
    .select({
      id: hrWorkCalendars.id,
      name: hrWorkCalendars.name,
      isDefault: hrWorkCalendars.isDefault,
    })
    .from(hrWorkCalendars)
    .where(and(eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.id, calendarId)))
    .limit(1);
  if (!calendar) {
    return null;
  }
  const daysByCalendar = await loadCalendarDays(db, tenantId, [calendar.id]);
  const days = daysByCalendar.get(calendar.id) ?? [];
  const totals = weekTotals(days);
  const attached = await db
    .select({ total: count() })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.workCalendarId, calendar.id)));
  return {
    ...calendar,
    weeklyHalfDays: totals.halfDays,
    weeklyHours: totals.hours,
    attachedEmployees: Number(attached[0]?.total ?? 0),
    days,
    firstDayOfWeek: firstWeekDay(days),
  };
}

async function insertCalendarDays(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly calendarId: string;
    readonly days: CalendarInput["days"];
  },
): Promise<void> {
  await tx.insert(hrWorkCalendarDays).values(
    input.days.map((day) => ({
      tenantId: input.tenantId,
      calendarId: input.calendarId,
      dayOfWeek: day.dayOfWeek,
      morningFrom: day.morningFrom,
      morningTo: day.morningTo,
      afternoonFrom: day.afternoonFrom,
      afternoonTo: day.afternoonTo,
      sequence: day.sequence,
    })),
  );
}

async function clearOtherDefaults(
  tx: Transaction,
  tenantId: string,
  keepCalendarId?: string,
): Promise<void> {
  const parts = [eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.isDefault, true)];
  if (keepCalendarId) {
    parts.push(sql`${hrWorkCalendars.id} <> ${keepCalendarId}`);
  }
  await tx
    .update(hrWorkCalendars)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(...parts));
}

export async function createWorkCalendar(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateCalendarInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateCalendarInput(input.raw), "Calendrier invalide.");
  try {
    return await db.transaction(async (tx) => {
      if (data.isDefault) {
        // L'index unique partiel se vérifie à chaque ordre : l'autre défaut part avant l'insertion.
        await clearOtherDefaults(tx, input.tenantId);
      }
      const [created] = await tx
        .insert(hrWorkCalendars)
        .values({
          tenantId: input.tenantId,
          name: data.name,
          isDefault: data.isDefault,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrWorkCalendars.id });
      if (!created) {
        rethrow("Le calendrier n'a pas pu être créé.");
      }
      await insertCalendarDays(tx, {
        tenantId: input.tenantId,
        calendarId: created.id,
        days: data.days,
      });
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.calendar.create",
        entityType: "hr_work_calendar",
        entityId: created.id,
        details: { name: data.name, isDefault: data.isDefault },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow(`Le calendrier « ${data.name} » porte déjà ce nom dans cet espace.`);
    }
    throw error;
  }
}

export async function updateWorkCalendar(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly calendarId: string;
    readonly raw: Parameters<typeof validateCalendarInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateCalendarInput(input.raw), "Calendrier invalide.");
  try {
    await db.transaction(async (tx) => {
      const before = await lockCalendar(tx, input.tenantId, input.calendarId);
      if (data.isDefault) {
        await clearOtherDefaults(tx, input.tenantId, before.id);
      }
      await tx
        .update(hrWorkCalendars)
        .set({ name: data.name, isDefault: data.isDefault, updatedAt: new Date() })
        .where(
          and(eq(hrWorkCalendars.tenantId, input.tenantId), eq(hrWorkCalendars.id, before.id)),
        );
      await tx
        .delete(hrWorkCalendarDays)
        .where(
          and(
            eq(hrWorkCalendarDays.tenantId, input.tenantId),
            eq(hrWorkCalendarDays.calendarId, before.id),
          ),
        );
      await insertCalendarDays(tx, {
        tenantId: input.tenantId,
        calendarId: before.id,
        days: data.days,
      });
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.calendar.update",
        entityType: "hr_work_calendar",
        entityId: before.id,
        details: {
          before: { name: before.name, isDefault: before.isDefault },
          after: { name: data.name, isDefault: data.isDefault },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow(`Le calendrier « ${data.name} » porte déjà ce nom dans cet espace.`);
    }
    throw error;
  }
}

export async function setWorkCalendarDefault(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly calendarId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const calendar = await lockCalendar(tx, input.tenantId, input.calendarId);
    if (calendar.isDefault) {
      return;
    }
    await clearOtherDefaults(tx, input.tenantId, calendar.id);
    await tx
      .update(hrWorkCalendars)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(eq(hrWorkCalendars.tenantId, input.tenantId), eq(hrWorkCalendars.id, calendar.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.calendar.default",
      entityType: "hr_work_calendar",
      entityId: calendar.id,
      details: { name: calendar.name },
    });
  });
}

export async function deleteWorkCalendar(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly calendarId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const calendar = await lockCalendar(tx, input.tenantId, input.calendarId);
    if (calendar.isDefault) {
      rethrow(
        "Le calendrier de l'espace ne se supprime pas : désignez un autre calendrier comme celui de l'espace.",
      );
    }
    const [attached] = await tx
      .select({ total: count() })
      .from(hrEmployees)
      .where(
        and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.workCalendarId, calendar.id)),
      );
    if (Number(attached?.total ?? 0) > 0) {
      rethrow(
        `Des fiches salarié pointent encore ce calendrier : rattachez-les avant de le supprimer.`,
      );
    }
    await tx
      .delete(hrWorkCalendars)
      .where(
        and(eq(hrWorkCalendars.tenantId, input.tenantId), eq(hrWorkCalendars.id, calendar.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.calendar.delete",
      entityType: "hr_work_calendar",
      entityId: calendar.id,
      details: { name: calendar.name },
    });
  });
}

async function lockCalendar(tx: Transaction, tenantId: string, id: string): Promise<CalendarRow> {
  const [row] = await tx
    .select({
      id: hrWorkCalendars.id,
      name: hrWorkCalendars.name,
      isDefault: hrWorkCalendars.isDefault,
    })
    .from(hrWorkCalendars)
    .where(and(eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.id, id)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Calendrier introuvable dans cet espace.");
  }
  return row;
}

/* ------------------------------------------------------------ jours fériés (HR-010) */

export interface PublicHolidayRow {
  readonly id: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: HrDayPeriod;
  readonly label: string;
}

export async function listPublicHolidays(
  db: Database,
  tenantId: string,
  input: { readonly year?: number | null } = {},
): Promise<readonly PublicHolidayRow[]> {
  const parts = [eq(hrPublicHolidays.tenantId, tenantId)];
  if (input.year) {
    parts.push(sql`EXTRACT(year FROM ${hrPublicHolidays.workDate}) = ${input.year}`);
  }
  return db
    .select({
      id: hrPublicHolidays.id,
      workDate: hrPublicHolidays.workDate,
      kind: hrPublicHolidays.kind,
      period: hrPublicHolidays.period,
      label: hrPublicHolidays.label,
    })
    .from(hrPublicHolidays)
    .where(and(...parts))
    .orderBy(asc(hrPublicHolidays.workDate), asc(hrPublicHolidays.period))
    .limit(HR_LIST_LIMIT);
}

export async function holidayYears(db: Database, tenantId: string): Promise<readonly number[]> {
  const rows = await db
    .select({ year: sql<number>`EXTRACT(year FROM ${hrPublicHolidays.workDate})::int` })
    .from(hrPublicHolidays)
    .where(eq(hrPublicHolidays.tenantId, tenantId))
    .groupBy(sql`1`)
    .orderBy(desc(sql`1`));
  return rows.map((row) => Number(row.year));
}

export async function getPublicHoliday(
  db: Database,
  tenantId: string,
  holidayId: string,
): Promise<PublicHolidayRow | null> {
  const [row] = await db
    .select({
      id: hrPublicHolidays.id,
      workDate: hrPublicHolidays.workDate,
      kind: hrPublicHolidays.kind,
      period: hrPublicHolidays.period,
      label: hrPublicHolidays.label,
    })
    .from(hrPublicHolidays)
    .where(and(eq(hrPublicHolidays.tenantId, tenantId), eq(hrPublicHolidays.id, holidayId)))
    .limit(1);
  return row ?? null;
}

export async function createPublicHoliday(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateHolidayInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateHolidayInput(input.raw), "Jour férié invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hrPublicHolidays)
        .values({
          tenantId: input.tenantId,
          workDate: data.workDate,
          kind: data.kind,
          period: data.period,
          label: data.label,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrPublicHolidays.id });
      if (!created) {
        rethrow("Le jour férié n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.holiday.create",
        entityType: "hr_public_holiday",
        entityId: created.id,
        details: {
          workDate: data.workDate,
          kind: data.kind,
          period: data.period,
          label: data.label,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow(`Le ${data.workDate} porte déjà une saisie pour cette période.`);
    }
    throw error;
  }
}

export async function updatePublicHoliday(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly holidayId: string;
    readonly raw: Parameters<typeof validateHolidayInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateHolidayInput(input.raw), "Jour férié invalide.");
  try {
    await db.transaction(async (tx) => {
      const before = await lockHoliday(tx, input.tenantId, input.holidayId);
      await tx
        .update(hrPublicHolidays)
        .set({
          workDate: data.workDate,
          kind: data.kind,
          period: data.period,
          label: data.label,
          updatedAt: new Date(),
        })
        .where(
          and(eq(hrPublicHolidays.tenantId, input.tenantId), eq(hrPublicHolidays.id, before.id)),
        );
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.holiday.update",
        entityType: "hr_public_holiday",
        entityId: before.id,
        details: {
          before: { workDate: before.workDate, kind: before.kind, period: before.period },
          after: { workDate: data.workDate, kind: data.kind, period: data.period },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow(`Le ${data.workDate} porte déjà une saisie pour cette période.`);
    }
    throw error;
  }
}

export async function deletePublicHoliday(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly holidayId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const holiday = await lockHoliday(tx, input.tenantId, input.holidayId);
    await tx
      .delete(hrPublicHolidays)
      .where(
        and(eq(hrPublicHolidays.tenantId, input.tenantId), eq(hrPublicHolidays.id, holiday.id)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.holiday.delete",
      entityType: "hr_public_holiday",
      entityId: holiday.id,
      details: { workDate: holiday.workDate, label: holiday.label },
    });
  });
}

interface HolidayRecord {
  readonly id: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: HrDayPeriod;
  readonly label: string;
}

async function lockHoliday(tx: Transaction, tenantId: string, id: string): Promise<HolidayRecord> {
  const [row] = await tx
    .select({
      id: hrPublicHolidays.id,
      workDate: hrPublicHolidays.workDate,
      kind: hrPublicHolidays.kind,
      period: hrPublicHolidays.period,
      label: hrPublicHolidays.label,
    })
    .from(hrPublicHolidays)
    .where(and(eq(hrPublicHolidays.tenantId, tenantId), eq(hrPublicHolidays.id, id)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Jour férié introuvable dans cet espace.");
  }
  return { ...row, period: row.period as HrDayPeriod };
}

/* ------------------------------------------------------ capacité et pointages (HR-011) */

export interface DayCapacity {
  readonly calendarId: string | null;
  readonly calendarName: string | null;
  readonly bounds: CalendarDayBounds;
  readonly holidays: readonly HrDayPeriod[];
  readonly halfDays: number;
  readonly hours: number;
}

async function holidayPeriods(
  db: DbLike,
  tenantId: string,
  workDate: string,
): Promise<readonly HrDayPeriod[]> {
  const rows = await db
    .select({ period: hrPublicHolidays.period })
    .from(hrPublicHolidays)
    .where(and(eq(hrPublicHolidays.tenantId, tenantId), eq(hrPublicHolidays.workDate, workDate)));
  return rows.map((row) => row.period as HrDayPeriod);
}

/** HR-009 — le calendrier de la fiche prime sur celui de l'espace. */
export async function resolveDayCapacity(
  db: DbLike,
  tenantId: string,
  employeeId: string,
  workDate: string,
): Promise<DayCapacity> {
  const [employee] = await db
    .select({ workCalendarId: hrEmployees.workCalendarId })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, employeeId)))
    .limit(1);
  if (!employee) {
    rethrow("Salarié introuvable dans cet espace.");
  }

  const [calendar] = employee.workCalendarId
    ? await db
        .select({ id: hrWorkCalendars.id, name: hrWorkCalendars.name })
        .from(hrWorkCalendars)
        .where(
          and(
            eq(hrWorkCalendars.tenantId, tenantId),
            eq(hrWorkCalendars.id, employee.workCalendarId),
          ),
        )
        .limit(1)
    : await db
        .select({ id: hrWorkCalendars.id, name: hrWorkCalendars.name })
        .from(hrWorkCalendars)
        .where(and(eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.isDefault, true)))
        .limit(1);

  const holidays = await holidayPeriods(db, tenantId, workDate);
  if (!calendar) {
    return {
      calendarId: null,
      calendarName: null,
      bounds: EMPTY_BOUNDS,
      holidays,
      halfDays: 0,
      hours: 0,
    };
  }

  const daysByCalendar = await loadCalendarDays(db, tenantId, [calendar.id]);
  const day = (daysByCalendar.get(calendar.id) ?? []).find(
    (candidate) => candidate.dayOfWeek === weekDayOf(workDate),
  );
  const bounds = boundsOfDay(day);
  return {
    calendarId: calendar.id,
    calendarName: calendar.name,
    bounds,
    holidays,
    halfDays: availableHalfDays(bounds, holidays),
    hours: availableHours(bounds, holidays),
  };
}

export interface TimeEntryRow {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: string;
  readonly hours: string | null;
  readonly status: HrTimeEntryStatus;
  readonly note: string | null;
}

const TIME_ENTRY_COLUMNS = {
  id: hrTimeEntries.id,
  employeeId: hrTimeEntries.employeeId,
  employeeCode: hrEmployees.code,
  lastName: hrEmployees.lastName,
  firstName: hrEmployees.firstName,
  workDate: hrTimeEntries.workDate,
  kind: hrTimeEntries.kind,
  period: hrTimeEntries.period,
  hours: hrTimeEntries.hours,
  status: hrTimeEntries.status,
  note: hrTimeEntries.note,
};

function toTimeEntryRow(row: {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: string;
  readonly hours: string | null;
  readonly status: HrTimeEntryStatus;
  readonly note: string | null;
}): TimeEntryRow {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: employeeFullName(row.lastName, row.firstName),
    workDate: row.workDate,
    kind: row.kind,
    period: row.period,
    hours: row.hours,
    status: row.status,
    note: row.note,
  };
}

export interface TimeEntryFilters {
  readonly tenantId: string;
  readonly employeeId?: string | null;
  readonly status?: HrTimeEntryStatus | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly search?: string | null;
  readonly limit?: number;
}

function timeEntryFilters(input: TimeEntryFilters) {
  const parts = [eq(hrTimeEntries.tenantId, input.tenantId)];
  if (input.employeeId) {
    parts.push(eq(hrTimeEntries.employeeId, input.employeeId));
  }
  if (input.status) {
    parts.push(eq(hrTimeEntries.status, input.status));
  }
  if (input.from) {
    parts.push(gte(hrTimeEntries.workDate, input.from));
  }
  if (input.to) {
    parts.push(lt(hrTimeEntries.workDate, input.to));
  }
  const search = (input.search ?? "").trim();
  if (search) {
    parts.push(
      or(
        ilike(hrEmployees.code, `%${search.replace(/[%_]/g, "")}%`),
        ilike(hrEmployees.lastName, `%${search.replace(/[%_]/g, "")}%`),
        ilike(hrEmployees.firstName, `%${search.replace(/[%_]/g, "")}%`),
      )!,
    );
  }
  return and(...parts);
}

/** HR-011 — liste des pointages, sans salaire (HR-005). */
export async function listTimeEntries(
  db: Database,
  input: TimeEntryFilters,
): Promise<readonly TimeEntryRow[]> {
  const rows = await db
    .select(TIME_ENTRY_COLUMNS)
    .from(hrTimeEntries)
    .innerJoin(hrEmployees, eq(hrTimeEntries.employeeId, hrEmployees.id))
    .where(timeEntryFilters(input))
    .orderBy(desc(hrTimeEntries.workDate), asc(hrEmployees.code))
    .limit(input.limit ?? HR_LIST_LIMIT);
  return rows.map((row) => toTimeEntryRow(row));
}

export async function getTimeEntry(
  db: Database,
  tenantId: string,
  entryId: string,
): Promise<TimeEntryRow | null> {
  const [row] = await db
    .select(TIME_ENTRY_COLUMNS)
    .from(hrTimeEntries)
    .innerJoin(hrEmployees, eq(hrTimeEntries.employeeId, hrEmployees.id))
    .where(and(eq(hrTimeEntries.tenantId, tenantId), eq(hrTimeEntries.id, entryId)))
    .limit(1);
  return row ? toTimeEntryRow(row) : null;
}

async function dayTotals(
  db: DbLike,
  tenantId: string,
  employeeId: string,
  workDate: string,
  excludeEntryId: string | null,
): Promise<EntryTotals> {
  const rows = await db
    .select({ period: hrTimeEntries.period, hours: hrTimeEntries.hours })
    .from(hrTimeEntries)
    .where(
      and(
        eq(hrTimeEntries.tenantId, tenantId),
        eq(hrTimeEntries.employeeId, employeeId),
        eq(hrTimeEntries.workDate, workDate),
        excludeEntryId ? sql`${hrTimeEntries.id} <> ${excludeEntryId}` : undefined,
      ),
    );
  let halfDays = 0;
  let hours = 0;
  for (const row of rows) {
    halfDays += entryHalfDays(row.period as TimeEntryInput["period"]);
    hours += entryHours(row.period as TimeEntryInput["period"], row.hours);
  }
  return { halfDays, hours };
}

/** HR-011 — date jamais future, capacité du calendrier applicable, période travaillée. */
export async function entryCapacityErrors(
  db: DbLike,
  tenantId: string,
  data: TimeEntryInput,
  excludeEntryId: string | null,
): Promise<string[]> {
  const today = todayIsoDate();
  if (data.workDate > today) {
    return ["Date du pointage : un pointage ne se saisit pas pour un jour futur."];
  }

  const capacity = await resolveDayCapacity(db, tenantId, data.employeeId, data.workDate);
  const totals = await dayTotals(db, tenantId, data.employeeId, data.workDate, excludeEntryId);
  const errors: string[] = [];

  if (data.period === "hours") {
    const hours = entryHours("hours", data.hours);
    if (capacity.hours <= 0) {
      errors.push(
        `${data.workDate} : ce jour ne compte aucune heure travaillée au calendrier applicable (jours fériés déduits).`,
      );
    } else if (totals.hours + hours - capacity.hours > 0.001) {
      errors.push(
        `${data.workDate} : ${formatHours(totals.hours + hours)} heures dépassent les ${formatHours(
          capacity.hours,
        )} heures que compte ce jour.`,
      );
    }
    return errors;
  }

  if (!isPeriodAvailable(capacity.bounds, capacity.holidays, data.period)) {
    const label = HR_WEEK_DAY_LABELS[weekDayOf(data.workDate)];
    errors.push(
      `${data.workDate} (${label}) : demi-journée non travaillée au calendrier applicable, ou déjà couverte par un jour férié ou chômé.`,
    );
  } else {
    const halfDays = totals.halfDays + entryHalfDays(data.period);
    if (halfDays - capacity.halfDays > 0.001) {
      errors.push(
        `${data.workDate} : ${formatHalfDays(halfDays)} demi-journée(s) dépassent ${formatHalfDays(
          capacity.halfDays,
        )} que compte ce jour.`,
      );
    }
  }
  return errors;
}

async function assertEntryAllowed(
  db: DbLike,
  tenantId: string,
  data: TimeEntryInput,
  excludeEntryId: string | null,
): Promise<void> {
  const errors = await entryCapacityErrors(db, tenantId, data, excludeEntryId);
  if (errors[0]) {
    rethrow(errors[0]);
  }
}

interface EntryRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: string;
  readonly hours: string | null;
  readonly status: HrTimeEntryStatus;
  readonly note: string | null;
}

async function lockEntry(tx: Transaction, tenantId: string, id: string): Promise<EntryRecord> {
  const [row] = await tx
    .select({
      id: hrTimeEntries.id,
      employeeId: hrTimeEntries.employeeId,
      workDate: hrTimeEntries.workDate,
      kind: hrTimeEntries.kind,
      period: hrTimeEntries.period,
      hours: hrTimeEntries.hours,
      status: hrTimeEntries.status,
      note: hrTimeEntries.note,
    })
    .from(hrTimeEntries)
    .where(and(eq(hrTimeEntries.tenantId, tenantId), eq(hrTimeEntries.id, id)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Pointage introuvable dans cet espace.");
  }
  return row;
}

function entryAuditDetails(
  employeeCode: string,
  data: {
    readonly workDate: string;
    readonly kind: string;
    readonly period: string;
    readonly hours: string | null;
    readonly note: string | null;
  },
): Record<string, unknown> {
  return {
    employeeCode,
    workDate: data.workDate,
    kind: data.kind,
    period: data.period,
    hours: data.hours,
  };
}

export async function createTimeEntry(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateTimeEntryInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateTimeEntryInput(input.raw), "Pointage invalide.");
  try {
    return await db.transaction(async (tx) => {
      const employee = await requireEntryEmployee(tx, input.tenantId, data.employeeId);
      await assertEntryAllowed(tx, input.tenantId, data, null);
      const [created] = await tx
        .insert(hrTimeEntries)
        .values({
          tenantId: input.tenantId,
          employeeId: employee.id,
          workDate: data.workDate,
          kind: data.kind,
          period: data.period,
          hours: data.hours,
          note: data.note,
          status: "draft",
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrTimeEntries.id });
      if (!created) {
        rethrow("Le pointage n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.time_entry.create",
        entityType: "hr_time_entry",
        entityId: created.id,
        details: entryAuditDetails(employee.code, data),
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow("Ce salarié a déjà un pointage pour ce jour et cette période.");
    }
    throw error;
  }
}

export async function updateTimeEntry(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly entryId: string;
    readonly raw: Parameters<typeof validateTimeEntryInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateTimeEntryInput(input.raw), "Pointage invalide.");
  try {
    await db.transaction(async (tx) => {
      const before = await lockEntry(tx, input.tenantId, input.entryId);
      if (before.status !== "draft") {
        rethrow("Pointage figé : il a quitté le brouillon. Repasse-le au brouillon pour corriger.");
      }
      const employee = await requireEntryEmployee(tx, input.tenantId, data.employeeId);
      await assertEntryAllowed(tx, input.tenantId, data, before.id);
      await tx
        .update(hrTimeEntries)
        .set({
          employeeId: employee.id,
          workDate: data.workDate,
          kind: data.kind,
          period: data.period,
          hours: data.hours,
          note: data.note,
          updatedAt: new Date(),
        })
        .where(and(eq(hrTimeEntries.tenantId, input.tenantId), eq(hrTimeEntries.id, before.id)));
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.time_entry.update",
        entityType: "hr_time_entry",
        entityId: before.id,
        details: {
          ...entryAuditDetails(employee.code, data),
          before: {
            workDate: before.workDate,
            kind: before.kind,
            period: before.period,
            hours: before.hours,
          },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow("Ce salarié a déjà un pointage pour ce jour et cette période.");
    }
    throw error;
  }
}

/** HR-011 — la validation et le retour au brouillon exigent la gestion. */
export async function setTimeEntryStatus(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly entryId: string;
    readonly status: HrTimeEntryStatus;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const entry = await lockEntry(tx, input.tenantId, input.entryId);
    if (entry.status === input.status) {
      return;
    }
    await tx
      .update(hrTimeEntries)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(hrTimeEntries.tenantId, input.tenantId), eq(hrTimeEntries.id, entry.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.status === "validated" ? "hr.time_entry.validate" : "hr.time_entry.reopen",
      entityType: "hr_time_entry",
      entityId: entry.id,
      details: { before: { status: entry.status }, after: { status: input.status } },
    });
  });
}

export async function deleteTimeEntry(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly entryId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const entry = await lockEntry(tx, input.tenantId, input.entryId);
    if (entry.status !== "draft") {
      rethrow("Seul un pointage brouillon se supprime.");
    }
    await tx
      .delete(hrTimeEntries)
      .where(and(eq(hrTimeEntries.tenantId, input.tenantId), eq(hrTimeEntries.id, entry.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.time_entry.delete",
      entityType: "hr_time_entry",
      entityId: entry.id,
      details: { workDate: entry.workDate, kind: entry.kind, period: entry.period },
    });
  });
}

async function requireEntryEmployee(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<{ id: string; code: string }> {
  const [row] = await tx
    .select({ id: hrEmployees.id, code: hrEmployees.code, status: hrEmployees.status })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, id)))
    .limit(1);
  if (!row) {
    rethrow("Salarié introuvable dans cet espace.");
  }
  if (row.status === "left") {
    rethrow(`${row.code} : ce salarié est sorti de l'effectif, son pointage ne se saisit plus.`);
  }
  return { id: row.id, code: row.code };
}

export interface TimeEntryCounters {
  readonly drafts: number;
  readonly validatedThisMonth: number;
  readonly absencesThisMonth: number;
  readonly workedHalfDaysThisMonth: number;
  readonly workedHoursThisMonth: number;
  readonly employeesPunchedThisMonth: number;
}

/** HR-007 — les compteurs de pointage sont recalculés à la lecture. */
export async function getTimeEntryCounters(
  db: Database,
  tenantId: string,
  today?: string,
): Promise<TimeEntryCounters> {
  const day = today ?? todayIsoDate();
  const month = `${day.slice(0, 7)}-01`;
  const [year, ordinal] = day.slice(0, 7).split("-").map(Number) as [number, number];
  const nextMonth =
    ordinal === 12 ? `${year + 1}-01-01` : `${year}-${String(ordinal + 1).padStart(2, "0")}-01`;

  const rows = await db
    .select({
      id: hrTimeEntries.id,
      employeeId: hrTimeEntries.employeeId,
      kind: hrTimeEntries.kind,
      period: hrTimeEntries.period,
      hours: hrTimeEntries.hours,
      status: hrTimeEntries.status,
      inMonth: sql<boolean>`${hrTimeEntries.workDate} >= ${month} and ${hrTimeEntries.workDate} < ${nextMonth}`,
    })
    .from(hrTimeEntries)
    .where(eq(hrTimeEntries.tenantId, tenantId));

  let drafts = 0;
  let validatedThisMonth = 0;
  let absencesThisMonth = 0;
  let workedHalfDays = 0;
  let workedHours = 0;
  const punchedEmployees = new Set<string>();

  for (const row of rows) {
    if (row.status === "draft") {
      drafts += 1;
    }
    if (!row.inMonth) {
      continue;
    }
    if (row.status === "validated") {
      validatedThisMonth += 1;
    }
    if (row.kind === "absence") {
      absencesThisMonth += 1;
      continue;
    }
    punchedEmployees.add(row.employeeId);
    workedHalfDays += entryHalfDays(row.period as TimeEntryInput["period"]);
    workedHours += entryHours(row.period as TimeEntryInput["period"], row.hours);
  }

  return {
    drafts,
    validatedThisMonth,
    absencesThisMonth,
    workedHalfDaysThisMonth: Math.round(workedHalfDays * 2) / 2,
    workedHoursThisMonth: Math.round(workedHours * 100) / 100,
    employeesPunchedThisMonth: punchedEmployees.size,
  };
}

/** HR-009 + HR-010 — ce que la période doit au travail pour un salarié, fériés déduits. */
export async function getExpectedPeriod(
  db: Database,
  tenantId: string,
  input: { readonly employeeId: string; readonly from: string; readonly to: string },
): Promise<{ readonly halfDays: number; readonly hours: number; readonly workedDays: number }> {
  const [employee] = await db
    .select({ workCalendarId: hrEmployees.workCalendarId })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, input.employeeId)))
    .limit(1);
  if (!employee) {
    rethrow("Salarié introuvable dans cet espace.");
  }

  const [calendar] = employee.workCalendarId
    ? await db
        .select({ id: hrWorkCalendars.id, name: hrWorkCalendars.name })
        .from(hrWorkCalendars)
        .where(
          and(
            eq(hrWorkCalendars.tenantId, tenantId),
            eq(hrWorkCalendars.id, employee.workCalendarId),
          ),
        )
        .limit(1)
    : await db
        .select({ id: hrWorkCalendars.id, name: hrWorkCalendars.name })
        .from(hrWorkCalendars)
        .where(and(eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.isDefault, true)))
        .limit(1);
  if (!calendar) {
    return { halfDays: 0, hours: 0, workedDays: 0 };
  }

  const days = (await loadCalendarDays(db, tenantId, [calendar.id])).get(calendar.id) ?? [];
  const boundsByDay = new Map(days.map((day) => [day.dayOfWeek, day]));

  const holidayRows = await db
    .select({ workDate: hrPublicHolidays.workDate, period: hrPublicHolidays.period })
    .from(hrPublicHolidays)
    .where(
      and(
        eq(hrPublicHolidays.tenantId, tenantId),
        gte(hrPublicHolidays.workDate, input.from),
        lte(hrPublicHolidays.workDate, input.to),
      ),
    );
  const holidaysByDate = new Map<string, HrDayPeriod[]>();
  for (const row of holidayRows) {
    const periods = holidaysByDate.get(row.workDate) ?? [];
    periods.push(row.period as HrDayPeriod);
    holidaysByDate.set(row.workDate, periods);
  }

  let halfDays = 0;
  let hours = 0;
  let workedDays = 0;
  for (let date = input.from; date <= input.to; date = addIsoDays(date, 1)) {
    const bounds = boundsByDay.get(weekDayOf(date)) ?? EMPTY_BOUNDS;
    const periods = holidaysByDate.get(date) ?? [];
    const dayHalfDays = availableHalfDays(bounds, periods);
    halfDays += dayHalfDays;
    hours += availableHours(bounds, periods);
    if (dayHalfDays > 0) {
      workedDays += 1;
    }
  }

  return {
    halfDays: Math.round(halfDays * 2) / 2,
    hours: Math.round(hours * 100) / 100,
    workedDays,
  };
}

/* --------------------------------------------------------- appui de saisie (HR-011) */

export interface PunchCalendarExpectation {
  readonly id: string;
  readonly name: string;
  readonly days: readonly WorkCalendarDay[];
}

export interface PunchExpectation {
  readonly calendars: readonly PunchCalendarExpectation[];
  readonly defaultCalendarId: string | null;
  readonly employeeCalendarIds: Readonly<Record<string, string | null>>;
  readonly holidaysByDate: Readonly<Record<string, readonly HrDayPeriod[]>>;
}

/**
 * HR-011 — ce que l'écran de saisie affiche avant l'écriture : le calendrier applicable de chaque
 * fiche — celui de la fiche sinon celui de l'espace — et les jours fériés ou chômés de la fenêtre.
 */
export async function getPunchExpectation(
  db: Database,
  tenantId: string,
  input: { readonly from: string; readonly to: string },
): Promise<PunchExpectation> {
  const [calendars, employees, holidayRows] = await Promise.all([
    db
      .select({
        id: hrWorkCalendars.id,
        name: hrWorkCalendars.name,
        isDefault: hrWorkCalendars.isDefault,
      })
      .from(hrWorkCalendars)
      .where(eq(hrWorkCalendars.tenantId, tenantId)),
    db
      .select({ id: hrEmployees.id, workCalendarId: hrEmployees.workCalendarId })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, tenantId), ne(hrEmployees.status, "left"))),
    db
      .select({ workDate: hrPublicHolidays.workDate, period: hrPublicHolidays.period })
      .from(hrPublicHolidays)
      .where(
        and(
          eq(hrPublicHolidays.tenantId, tenantId),
          gte(hrPublicHolidays.workDate, input.from),
          lte(hrPublicHolidays.workDate, input.to),
        ),
      ),
  ]);

  const ids = calendars.map((calendar) => calendar.id);
  const daysByCalendar = await loadCalendarDays(db, tenantId, ids);

  const holidaysByDate: Record<string, HrDayPeriod[]> = {};
  for (const row of holidayRows) {
    const periods = holidaysByDate[row.workDate] ?? [];
    periods.push(row.period as HrDayPeriod);
    holidaysByDate[row.workDate] = periods;
  }

  const employeeCalendarIds: Record<string, string | null> = {};
  for (const employee of employees) {
    employeeCalendarIds[employee.id] = employee.workCalendarId;
  }

  return {
    calendars: calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      days: daysByCalendar.get(calendar.id) ?? [],
    })),
    defaultCalendarId: calendars.find((calendar) => calendar.isDefault)?.id ?? null,
    employeeCalendarIds,
    holidaysByDate,
  };
}
