import { createHash } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, hrTimeEntries, importRows, type HrCalendarDay } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import {
  HEADERS_BY_KIND,
  HR_TIME_ENTRY_HEADERS,
  IMPORT_TEMPLATE_PATHS,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
} from "@/modules/catalog/constants";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import { buildTemplate, templateFileName } from "@/modules/catalog/xlsx";
import type { RawImportRow } from "@/modules/catalog/validation";
import { HR_WEEK_DAYS } from "./constants";
import { HrError } from "./errors";
import { createEmployee, updateEmployee } from "./queries";
import { addIsoDays } from "./validation";
import {
  createPublicHoliday,
  createTimeEntry,
  createWorkCalendar,
  deletePublicHoliday,
  deleteTimeEntry,
  deleteWorkCalendar,
  getExpectedPeriod,
  getPunchExpectation,
  getTimeEntry,
  getTimeEntryCounters,
  getWorkCalendar,
  listPublicHolidays,
  listTimeEntries,
  listWorkCalendars,
  resolveDayCapacity,
  setTimeEntryStatus,
  setWorkCalendarDefault,
  updatePublicHoliday,
  updateTimeEntry,
  updateWorkCalendar,
} from "./time-queries";
import {
  validateCalendarInput,
  validateHolidayInput,
  validateTimeEntryInput,
  type CalendarDayRaw,
} from "./time-validation";

const TODAY = todayIsoDate();
/** Lundi de la semaine écoulée : ses six jours suivants restent dans le passé. */
const MONDAY = addIsoDays(TODAY, -(((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7) + 7));
const TUESDAY = addIsoDays(MONDAY, 1);
const WEDNESDAY = addIsoDays(MONDAY, 2);
const THURSDAY = addIsoDays(MONDAY, 3);
const FRIDAY = addIsoDays(MONDAY, 4);
const SATURDAY = addIsoDays(MONDAY, 5);
const SUNDAY = addIsoDays(MONDAY, 6);
const YEAR = Number(MONDAY.slice(0, 4));
const FUTURE = addIsoDays(TODAY, 4);
const ANY_UUID = "11111111-1111-4111-8111-111111111111";

const FULL_DAY = {
  morningFrom: "08:00",
  morningTo: "12:00",
  afternoonFrom: "14:00",
  afternoonTo: "17:00",
};
const EMPTY_DAY = { morningFrom: "", morningTo: "", afternoonFrom: "", afternoonTo: "" };
const WORK_WEEK: readonly HrCalendarDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

/** Sept lignes, une par jour : les jours ouvrés portent matin et après-midi, les autres rien. */
function week(workedDays: readonly HrCalendarDay[] = WORK_WEEK): Record<string, CalendarDayRaw> {
  const days: Record<string, CalendarDayRaw> = {};
  HR_WEEK_DAYS.forEach((dayOfWeek, index) => {
    const bounds = workedDays.includes(dayOfWeek) ? FULL_DAY : EMPTY_DAY;
    days[dayOfWeek] = { ...bounds, sequence: String(index + 1) };
  });
  return days;
}

async function makeCalendar(
  tenant: HrTenant,
  name: string,
  options: { days?: Record<string, CalendarDayRaw>; isDefault?: boolean } = {},
): Promise<string> {
  const created = await createWorkCalendar(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: { name, isDefault: options.isDefault ?? false, days: options.days ?? week() },
  });
  return created.id;
}

let employeeCounter = 0;

async function makeEmployee(
  tenant: HrTenant,
  options: { code?: string; workCalendarId?: string; status?: string } = {},
): Promise<{ id: string; code: string }> {
  employeeCounter += 1;
  const code = options.code ?? `T${String(employeeCounter).padStart(6, "0")}`;
  const created = await createEmployee(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: {
      code,
      lastName: "KOUAME",
      firstName: "Awa",
      position: "Agent",
      hireDate: "2026-01-05",
      status: options.status ?? "active",
      departureDate: options.status === "left" ? TODAY : "",
      departmentId: "",
      managerEmployeeId: "",
      workCalendarId: options.workCalendarId ?? "",
    },
  });
  return { id: created.id, code };
}

async function makeHoliday(
  tenant: HrTenant,
  workDate: string,
  options: { kind?: string; period?: string; label?: string } = {},
): Promise<string> {
  const created = await createPublicHoliday(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: {
      workDate,
      kind: options.kind ?? "public_holiday",
      period: options.period ?? "full",
      label: options.label ?? "Fête test",
    },
  });
  return created.id;
}

function entryRaw(
  employeeId: string,
  workDate: string,
  options: { kind?: string; period?: string; hours?: string; note?: string } = {},
) {
  return {
    employeeId,
    workDate,
    kind: options.kind ?? "worked",
    period: options.period ?? "full",
    hours: options.hours ?? "",
    note: options.note ?? "",
  };
}

async function punch(
  tenant: HrTenant,
  employeeId: string,
  workDate: string,
  options: { kind?: string; period?: string; hours?: string; note?: string } = {},
): Promise<string> {
  const created = await createTimeEntry(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: entryRaw(employeeId, workDate, options),
  });
  return created.id;
}

async function auditActions(tenant: HrTenant, entityType: string, entityId: string) {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenant.tenantId),
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      ),
    )
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
  return rows.map((row) => row.action);
}

type LoadInput = Parameters<Workbook["xlsx"]["load"]>[0];

function hashOf(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

function timeRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      matricule: "IMP1001",
      date: MONDAY,
      nature: "Travaillé",
      periode: "Journée",
      heures: "",
      motif: "",
      ...overrides,
    },
  };
}

function analyzePointages(tenant: HrTenant, rows: readonly RawImportRow[], fileHash: string) {
  return analyzeImport(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    kind: "hr_time_entries",
    fileName: "pointages.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function entryCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(hrTimeEntries)
    .where(eq(hrTimeEntries.tenantId, tenantId));
  return row?.value ?? 0;
}

function applyBatch(tenant: HrTenant, batchId: string) {
  return applyImportBatch(db, {
    tenantId: tenant.tenantId,
    batchId,
    actorUserId: tenant.userId,
  });
}

async function storedRows(tenant: HrTenant, batchId: string) {
  const detail = await getImportBatch(db, { tenantId: tenant.tenantId, batchId });
  return detail?.rows ?? [];
}

/** Le pilote de reprise d'un brouillon, tel que l'analyse l'écrit dans la ligne du lot. */
async function updateIdOf(batchId: string, rowNumber: number): Promise<string | null> {
  const [row] = await db
    .select({ data: importRows.data })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.rowNumber, rowNumber)));
  return ((row?.data ?? {}) as { updateId?: string | null }).updateId ?? null;
}

function entriesOf(employeeId: string) {
  return db
    .select({
      id: hrTimeEntries.id,
      workDate: hrTimeEntries.workDate,
      kind: hrTimeEntries.kind,
      period: hrTimeEntries.period,
      hours: hrTimeEntries.hours,
      note: hrTimeEntries.note,
      status: hrTimeEntries.status,
    })
    .from(hrTimeEntries)
    .where(eq(hrTimeEntries.employeeId, employeeId));
}

describe("HR-009 — calendrier hebdomadaire de l'espace", () => {
  it("pose sept jours et rend la valeur travaillée de la semaine", async () => {
    const ids = await seedHrTenant(db, "calendrier-valeur");
    const calendarId = await makeCalendar(ids, "Cadres cinq jours", { isDefault: true });

    const detail = await getWorkCalendar(db, ids.tenantId, calendarId);
    expect(detail?.days).toHaveLength(7);
    expect(detail?.isDefault).toBe(true);
    expect(detail?.firstDayOfWeek).toBe("monday");
    expect(detail?.name).toBe("Cadres cinq jours");
    // Cinq jours à 4 h le matin et 3 h l'après-midi.
    expect(detail?.weeklyHalfDays).toBe(5);
    expect(detail?.weeklyHours).toBe(35);
    expect(detail?.attachedEmployees).toBe(0);

    const saturday = await resolveDayCapacity(
      db,
      ids.tenantId,
      (await makeEmployee(ids)).id,
      SATURDAY,
    );
    expect(saturday.halfDays).toBe(0);
    expect(saturday.hours).toBe(0);
    expect(saturday.calendarName).toBe("Cadres cinq jours");
  });

  it("compte une demi-journée seulement quand ses deux bornes sont posées", async () => {
    const ids = await seedHrTenant(db, "calendrier-demi");
    const days = week();
    for (const day of WORK_WEEK) {
      days[day] = {
        morningFrom: "08:00",
        morningTo: "12:30",
        afternoonFrom: "",
        afternoonTo: "",
        sequence: "1",
      };
    }
    const calendarId = await makeCalendar(ids, "Matinées seules", { days, isDefault: true });

    const detail = await getWorkCalendar(db, ids.tenantId, calendarId);
    expect(detail?.weeklyHalfDays).toBe(2.5);
    expect(detail?.weeklyHours).toBe(22.5);

    const monday = await resolveDayCapacity(db, ids.tenantId, (await makeEmployee(ids)).id, MONDAY);
    expect(monday.halfDays).toBe(0.5);
    expect(monday.hours).toBe(4.5);
  });

  it("refuse une demi-journée à une seule borne, une fin avant son début et l'après-midi avant le matin", () => {
    expect(
      validateCalendarInput({ name: "Incomplet", days: { monday: { morningFrom: "08:00" } } })
        .errors,
    ).toContain("Lundi : le matin demande une heure de début et une heure de fin.");

    expect(
      validateCalendarInput({
        name: "Renversé",
        days: { monday: { morningFrom: "12:00", morningTo: "08:00" } },
      }).errors,
    ).toContain("Lundi : le matin se termine avant de commencer.");

    expect(
      validateCalendarInput({
        name: "Croisé",
        days: {
          monday: {
            morningFrom: "08:00",
            morningTo: "13:00",
            afternoonFrom: "12:30",
            afternoonTo: "17:00",
          },
        },
      }).errors,
    ).toContain("Lundi : l'après-midi commence avant la fin du matin.");

    expect(
      validateCalendarInput({
        name: "Mal formé",
        days: { monday: { morningFrom: "8h", morningTo: "12:00" } },
      }).errors,
    ).toContain("Lundi matin : heure HH:MM attendue.");

    expect(
      validateCalendarInput({ name: "Rang", days: { monday: { sequence: "9" } } }).errors,
    ).toContain("Lundi : rang entre 1 et 7 attendu.");
  });

  it("désigne un seul calendrier de l'espace et place le premier jour au plus faible rang", async () => {
    const ids = await seedHrTenant(db, "calendrier-default");
    const five = await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const four = await makeCalendar(ids, "Quatre jours", {
      days: week(["monday", "tuesday", "wednesday", "thursday"]),
    });

    const before = await listWorkCalendars(db, ids.tenantId);
    expect(before.filter((calendar) => calendar.isDefault).map((calendar) => calendar.id)).toEqual([
      five,
    ]);

    await setWorkCalendarDefault(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      calendarId: four,
    });
    const after = await listWorkCalendars(db, ids.tenantId);
    expect(after.filter((calendar) => calendar.isDefault).map((calendar) => calendar.id)).toEqual([
      four,
    ]);
    expect(await auditActions(ids, "hr_work_calendar", four)).toContain("hr.calendar.default");

    const sundayFirst = await makeCalendar(ids, "Semaine du dimanche", {
      days: {
        ...week(["sunday", "monday", "tuesday", "wednesday", "thursday"]),
        sunday: { ...FULL_DAY, sequence: "1" },
        monday: { ...FULL_DAY, sequence: "2" },
      },
    });
    expect((await getWorkCalendar(db, ids.tenantId, sundayFirst))?.firstDayOfWeek).toBe("sunday");
  });

  it("bloque un nom déjà pris dans l'espace et laisse l'espace voisin le reprendre", async () => {
    const ids = await seedHrTenant(db, "calendrier-nom");
    await makeCalendar(ids, "Dupliqué");
    await expect(makeCalendar(ids, "Dupliqué")).rejects.toThrow(/déjà ce nom/);
    await expect(
      createWorkCalendar(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { name: "   ", days: week() },
      }),
    ).rejects.toThrow(HrError);

    const other = await seedHrTenant(db, "calendrier-nom-voisin");
    expect(await makeCalendar(other, "Dupliqué")).toBeTruthy();
  });

  it("refuse de supprimer le calendrier de l'espace ou un calendrier encore rattaché", async () => {
    const ids = await seedHrTenant(db, "calendrier-suppression");
    const shared = await makeCalendar(ids, "Celui de l'espace", { isDefault: true });
    await expect(
      deleteWorkCalendar(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        calendarId: shared,
      }),
    ).rejects.toThrow(/calendrier de l'espace ne se supprime pas/);

    const attached = await makeCalendar(ids, "Équipe du matin");
    const employee = await makeEmployee(ids, { workCalendarId: attached });
    await expect(
      deleteWorkCalendar(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        calendarId: attached,
      }),
    ).rejects.toThrow(/rattachez-les avant/);

    await updateEmployee(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      raw: {
        code: employee.code,
        lastName: "KOUAME",
        firstName: "Awa",
        position: "Agent",
        hireDate: "2026-01-05",
        status: "active",
        departmentId: "",
        managerEmployeeId: "",
        workCalendarId: shared,
      },
    });
    await deleteWorkCalendar(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      calendarId: attached,
    });

    const rest = await listWorkCalendars(db, ids.tenantId);
    expect(rest.map((calendar) => calendar.id)).not.toContain(attached);
    expect(rest.find((calendar) => calendar.id === shared)?.attachedEmployees).toBe(1);
  });
});

describe("HR-009 — le calendrier de la fiche prime pour elle seule", () => {
  it("rattache un calendrier à la fiche et refuse celui d'un autre espace", async () => {
    const ids = await seedHrTenant(db, "fiche-calendrier");
    const other = await seedHrTenant(db, "fiche-calendrier-voisin");
    const shared = await makeCalendar(ids, "Cinq jours commun", { isDefault: true });
    const own = await makeCalendar(ids, "Quatre jours cadre", {
      days: week(["monday", "tuesday", "wednesday", "thursday"]),
    });
    const foreign = await makeCalendar(other, "Calendrier voisin");

    await expect(makeEmployee(ids, { workCalendarId: foreign })).rejects.toThrow(
      /Calendrier de travail introuvable dans cet espace/,
    );

    const framed = await makeEmployee(ids, { workCalendarId: own });
    const colleague = await makeEmployee(ids);

    const framedDay = await resolveDayCapacity(db, ids.tenantId, framed.id, FRIDAY);
    expect(framedDay.calendarId).toBe(own);
    expect(framedDay.halfDays).toBe(0);

    const colleagueDay = await resolveDayCapacity(db, ids.tenantId, colleague.id, FRIDAY);
    expect(colleagueDay.calendarId).toBe(shared);
    expect(colleagueDay.halfDays).toBe(1);

    const list = await listWorkCalendars(db, ids.tenantId);
    expect(list.find((calendar) => calendar.id === own)?.attachedEmployees).toBe(1);
  });

  it("un calendrier modifié rétroagit sur les décomptes déjà lus", async () => {
    const ids = await seedHrTenant(db, "retroactif");
    const calendarId = await makeCalendar(ids, "Semaine allégée", { isDefault: true });
    const employee = await makeEmployee(ids);

    const before = await getExpectedPeriod(db, ids.tenantId, {
      employeeId: employee.id,
      from: MONDAY,
      to: FRIDAY,
    });
    expect(before).toEqual({ halfDays: 5, hours: 35, workedDays: 5 });

    await updateWorkCalendar(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      calendarId,
      raw: {
        name: "Semaine allégée",
        isDefault: true,
        days: week(["monday", "tuesday", "wednesday"]),
      },
    });

    const after = await getExpectedPeriod(db, ids.tenantId, {
      employeeId: employee.id,
      from: MONDAY,
      to: FRIDAY,
    });
    expect(after).toEqual({ halfDays: 3, hours: 21, workedDays: 3 });
  });

  it("ne compte rien quand l'espace ne s'est donné aucun calendrier", async () => {
    const ids = await seedHrTenant(db, "sans-calendrier");
    const employee = await makeEmployee(ids);

    const capacity = await resolveDayCapacity(db, ids.tenantId, employee.id, MONDAY);
    expect(capacity.calendarId).toBeNull();
    expect(capacity.halfDays).toBe(0);
    expect(
      await getExpectedPeriod(db, ids.tenantId, {
        employeeId: employee.id,
        from: MONDAY,
        to: FRIDAY,
      }),
    ).toEqual({
      halfDays: 0,
      hours: 0,
      workedDays: 0,
    });
  });
});

describe("HR-010 — jours fériés et chômés", () => {
  it("déduit la journée, le matin ou l'après-midi couvert de la valeur du jour", async () => {
    const ids = await seedHrTenant(db, "feries-capacite");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);

    await makeHoliday(ids, MONDAY);
    const full = await resolveDayCapacity(db, ids.tenantId, employee.id, MONDAY);
    expect(full.halfDays).toBe(0);
    expect(full.hours).toBe(0);
    expect(full.holidays).toEqual(["full"]);

    await makeHoliday(ids, TUESDAY, { kind: "unworked", period: "morning", label: "Chômé matin" });
    const morning = await resolveDayCapacity(db, ids.tenantId, employee.id, TUESDAY);
    expect(morning.halfDays).toBe(0.5);
    expect(morning.hours).toBe(3);

    const weekExpectation = await getExpectedPeriod(db, ids.tenantId, {
      employeeId: employee.id,
      from: MONDAY,
      to: FRIDAY,
    });
    expect(weekExpectation).toEqual({ halfDays: 3.5, hours: 24, workedDays: 4 });
  });

  it("laisse à zéro une fraction posée sur un jour déjà non travaillé", async () => {
    const ids = await seedHrTenant(db, "feries-dimanche");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);

    await makeHoliday(ids, SUNDAY);
    await makeHoliday(ids, SATURDAY, { kind: "unworked", period: "afternoon", label: "Samedi" });

    const sunday = await resolveDayCapacity(db, ids.tenantId, employee.id, SUNDAY);
    expect(sunday.halfDays).toBe(0);
    expect(sunday.hours).toBe(0);
    const saturday = await resolveDayCapacity(db, ids.tenantId, employee.id, SATURDAY);
    expect(saturday.halfDays).toBe(0);
  });

  it("une seule saisie par date et période, et l'isolation par espace tient", async () => {
    const ids = await seedHrTenant(db, "feries-doublon");
    const other = await seedHrTenant(db, "feries-doublon-voisin");
    await makeHoliday(ids, WEDNESDAY);
    await expect(makeHoliday(ids, WEDNESDAY)).rejects.toThrow(/porte déjà une saisie/);

    await makeHoliday(ids, WEDNESDAY, { period: "morning", label: "Matinée" });
    const rows = await listPublicHolidays(db, ids.tenantId, { year: YEAR });
    expect(rows.filter((row) => row.workDate === WEDNESDAY)).toHaveLength(2);

    await makeHoliday(other, WEDNESDAY, { label: "Fête du voisin" });
    const voisines = await listPublicHolidays(db, other.tenantId, { year: YEAR });
    expect(voisines.map((row) => row.label)).toEqual(["Fête du voisin"]);
    const ici = await listPublicHolidays(db, ids.tenantId, { year: YEAR });
    expect(ici.map((row) => row.label)).not.toContain("Fête du voisin");
  });

  it("se lit par libellé français et la nature ne change rien au calcul", async () => {
    const byLabel = validateHolidayInput({
      workDate: MONDAY,
      kind: "Chômé",
      period: "Après-midi",
      label: "Fête locale",
    });
    expect(byLabel.data).toMatchObject({ kind: "unworked", period: "afternoon" });

    const unknown = validateHolidayInput({
      workDate: MONDAY,
      kind: "Congé",
      period: "Nuit",
      label: "Mauvaise nature",
    });
    expect(unknown.errors).toContain("Nature : Férié ou Chômé attendu.");
    expect(unknown.errors).toContain("Période : Journée, Matin ou Après-midi attendu.");

    const ids = await seedHrTenant(db, "feries-nature");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);
    await makeHoliday(ids, FRIDAY, { kind: "unworked", label: "Jour chômé" });
    const capacity = await resolveDayCapacity(db, ids.tenantId, employee.id, FRIDAY);
    expect(capacity.halfDays).toBe(0);
    expect(capacity.hours).toBe(0);
  });

  it("se corrige et se retire en gardant la trace auditable", async () => {
    const ids = await seedHrTenant(db, "feries-audit");
    const holidayId = await makeHoliday(ids, MONDAY, { label: "Avant" });

    await updatePublicHoliday(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      holidayId,
      raw: { workDate: MONDAY, kind: "public_holiday", period: "full", label: "Après" },
    });
    expect(await auditActions(ids, "hr_public_holiday", holidayId)).toEqual([
      "hr.holiday.create",
      "hr.holiday.update",
    ]);

    const moved = await makeHoliday(ids, TUESDAY, { label: "Déplacé" });
    await deletePublicHoliday(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      holidayId: moved,
    });
    const rest = await listPublicHolidays(db, ids.tenantId, { year: YEAR });
    expect(rest.map((row) => row.id)).not.toContain(moved);
    expect(rest.map((row) => row.label)).toEqual(["Après"]);
    expect(await auditActions(ids, "hr_public_holiday", moved)).toEqual([
      "hr.holiday.create",
      "hr.holiday.delete",
    ]);

    await expect(
      deletePublicHoliday(db, {
        tenantId: ids.otherTenantId,
        actorUserId: ids.otherUserId,
        holidayId,
      }),
    ).rejects.toThrow(/Jour férié introuvable dans cet espace/);
  });
});

describe("HR-011 — saisie des pointages", () => {
  it("naît en brouillon et refuse le jour futur, le salarié hors espace et l'effectif sorti", async () => {
    const ids = await seedHrTenant(db, "pointage-base");
    const other = await seedHrTenant(db, "pointage-base-voisin");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    await makeCalendar(other, "Cinq jours voisin", { isDefault: true });
    const employee = await makeEmployee(ids);

    const created = await punch(ids, employee.id, MONDAY);
    const [row] = await db
      .select({ status: hrTimeEntries.status })
      .from(hrTimeEntries)
      .where(eq(hrTimeEntries.id, created));
    expect(row?.status).toBe("draft");

    await expect(punch(ids, employee.id, FUTURE)).rejects.toThrow(/jour futur/);
    await expect(punch(ids, (await makeEmployee(other)).id, MONDAY)).rejects.toThrow(
      /Salarié introuvable dans cet espace/,
    );

    const left = await makeEmployee(ids, { status: "left" });
    await expect(punch(ids, left.id, MONDAY)).rejects.toThrow(/sorti de l'effectif/);
  });

  it("respecte la capacité du jour : journée, demi-journées et heures", async () => {
    const ids = await seedHrTenant(db, "pointage-capacite");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);

    await expect(punch(ids, employee.id, SATURDAY)).rejects.toThrow(
      /non travaillée au calendrier applicable/,
    );

    await punch(ids, employee.id, MONDAY, { period: "morning" });
    await expect(punch(ids, employee.id, MONDAY, { period: "morning" })).rejects.toThrow(
      /déjà un pointage pour ce jour et cette période/,
    );
    await punch(ids, employee.id, MONDAY, { period: "afternoon" });

    // Mardi : la journée vaut les deux demi-journées, plus rien ne passe après.
    await punch(ids, employee.id, TUESDAY);
    await expect(punch(ids, employee.id, TUESDAY, { period: "morning" })).rejects.toThrow(
      /demi-journée\(s\) dépassent/,
    );

    // Mercredi : les 7 h du jour passent, 8 h dépassent.
    await punch(ids, employee.id, WEDNESDAY, { period: "hours", hours: "7" });
    await expect(
      punch(ids, employee.id, WEDNESDAY, { period: "hours", hours: "8" }),
    ).rejects.toThrow(/dépassent les 7 heures que compte ce jour/);

    // Vendredi : les lignes en heures se cumulent, 6,5 h puis 0,5 h, la troisième déborde.
    await punch(ids, employee.id, FRIDAY, { period: "hours", hours: "6.5" });
    await punch(ids, employee.id, FRIDAY, { period: "hours", hours: "0.5" });
    await expect(
      punch(ids, employee.id, FRIDAY, { period: "hours", hours: "0.25" }),
    ).rejects.toThrow(/7,25 heures dépassent les 7 heures/);

    const punches = await listTimeEntries(db, { tenantId: ids.tenantId, employeeId: employee.id });
    expect(punches).toHaveLength(6);
    expect(punches.map((entry) => entry.employeeName)).toContain("KOUAME Awa");
  });

  it("aucune heure sur un jour férié, et le travaillé se distingue de l'absence motivée", async () => {
    const ids = await seedHrTenant(db, "pointage-ferie");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);
    await makeHoliday(ids, MONDAY);

    await expect(punch(ids, employee.id, MONDAY, { period: "hours", hours: "1" })).rejects.toThrow(
      /aucune heure travaillée au calendrier applicable/,
    );
    await expect(
      punch(ids, employee.id, MONDAY, { kind: "absence", note: "Route coupée" }),
    ).rejects.toThrow(/non travaillée au calendrier applicable/);

    await expect(punch(ids, employee.id, TUESDAY, { kind: "absence" })).rejects.toThrow(
      /une absence explique son motif/,
    );
    await expect(punch(ids, employee.id, TUESDAY, { note: "Commentaire inutile" })).rejects.toThrow(
      /un travaillé ne se justifie pas/,
    );

    await punch(ids, employee.id, TUESDAY, { kind: "absence", note: "Formation" });
    const entries = await listTimeEntries(db, { tenantId: ids.tenantId, employeeId: employee.id });
    expect(entries[0]).toMatchObject({ kind: "absence", note: "Formation", period: "full" });
  });

  it("exige des heures au quart d'heure, jamais nulles ni hors bornes", () => {
    const base = { employeeId: ANY_UUID, workDate: MONDAY };
    expect(
      validateTimeEntryInput({ ...base, kind: "worked", period: "hours", hours: "" }).errors,
    ).toContain("Heures : obligatoire quand la durée se saisit en heures.");
    expect(
      validateTimeEntryInput({ ...base, kind: "worked", period: "hours", hours: "7.3" }).errors,
    ).toContain("Heures : durée au quart d'heure près.");
    expect(
      validateTimeEntryInput({ ...base, kind: "worked", period: "hours", hours: "0" }).errors,
    ).toContain("Heures : entre 0.25 et 24 heures attendues.");
    expect(
      validateTimeEntryInput({ ...base, kind: "worked", period: "full", hours: "1.5" }).errors,
    ).toContain("Heures : une durée en journée, matin ou après-midi ne porte pas d'heures.");
    expect(
      validateTimeEntryInput({ ...base, kind: "Travaillé", period: "Matin", hours: "" }).data,
    ).toMatchObject({ kind: "worked", period: "morning" });
    expect(validateTimeEntryInput({ ...base, kind: "Ouvré", period: "Nuit" }).errors).toEqual([
      "Nature : Travaillé ou Absence attendu.",
      "Période : Journée, Matin, Après-midi ou Heures attendue.",
    ]);
  });
});

describe("HR-011 — brouillon, validation et retour", () => {
  it("fige le pointage validé et ne l'ouvre qu'après retour au brouillon", async () => {
    const ids = await seedHrTenant(db, "pointage-statuts");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids);
    const entryId = await punch(ids, employee.id, MONDAY, { period: "morning" });

    await setTimeEntryStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId,
      status: "validated",
    });

    await expect(
      updateTimeEntry(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        entryId,
        raw: entryRaw(employee.id, MONDAY, { period: "afternoon" }),
      }),
    ).rejects.toThrow(/Pointage figé/);
    await expect(
      deleteTimeEntry(db, { tenantId: ids.tenantId, actorUserId: ids.userId, entryId }),
    ).rejects.toThrow(/Seul un pointage brouillon se supprime/);
    await expect(punch(ids, employee.id, MONDAY, { period: "morning" })).rejects.toThrow(
      /déjà un pointage pour ce jour et cette période/,
    );

    await setTimeEntryStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId,
      status: "draft",
    });
    await updateTimeEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId,
      raw: entryRaw(employee.id, MONDAY, { period: "afternoon" }),
    });

    const reopened = await getTimeEntry(db, ids.tenantId, entryId);
    expect(reopened).toMatchObject({ period: "afternoon", status: "draft" });

    expect(await auditActions(ids, "hr_time_entry", entryId)).toEqual([
      "hr.time_entry.create",
      "hr.time_entry.validate",
      "hr.time_entry.reopen",
      "hr.time_entry.update",
    ]);

    await deleteTimeEntry(db, { tenantId: ids.tenantId, actorUserId: ids.userId, entryId });
    expect(await getTimeEntry(db, ids.tenantId, entryId)).toBeNull();
    expect(await auditActions(ids, "hr_time_entry", entryId)).toContain("hr.time_entry.delete");
  });

  it("ne laisse jamais lire un pointage d'un espace voisin", async () => {
    const ids = await seedHrTenant(db, "pointage-isolation");
    const other = await seedHrTenant(db, "pointage-isolation-voisin");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    await makeCalendar(other, "Cinq jours voisin", { isDefault: true });
    const entryId = await punch(ids, (await makeEmployee(ids)).id, MONDAY);

    expect(await getTimeEntry(db, other.tenantId, entryId)).toBeNull();
    expect(await listTimeEntries(db, { tenantId: other.tenantId })).toEqual([]);
    await expect(
      setTimeEntryStatus(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        entryId,
        status: "validated",
      }),
    ).rejects.toThrow(/Pointage introuvable dans cet espace/);
    await expect(
      deleteTimeEntry(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        entryId,
      }),
    ).rejects.toThrow(/Pointage introuvable dans cet espace/);
  });

  it("filtre la liste et recompte les compteurs à la lecture", async () => {
    const ids = await seedHrTenant(db, "pointage-liste");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const first = await makeEmployee(ids, { code: "LISTE001" });
    const second = await makeEmployee(ids, { code: "LISTE002" });

    const morning = await punch(ids, first.id, MONDAY, { period: "morning" });
    await punch(ids, first.id, MONDAY, { period: "afternoon" });
    const absence = await punch(ids, second.id, MONDAY, {
      kind: "absence",
      period: "hours",
      hours: "2",
      note: "Consultation",
    });
    await setTimeEntryStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: morning,
      status: "validated",
    });
    await setTimeEntryStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: absence,
      status: "validated",
    });

    expect(await listTimeEntries(db, { tenantId: ids.tenantId, status: "validated" })).toHaveLength(
      2,
    );
    expect(await listTimeEntries(db, { tenantId: ids.tenantId, status: "draft" })).toHaveLength(1);
    expect(
      await listTimeEntries(db, { tenantId: ids.tenantId, employeeId: first.id }),
    ).toHaveLength(2);
    expect(await listTimeEntries(db, { tenantId: ids.tenantId, search: "liste002" })).toHaveLength(
      1,
    );
    expect(await listTimeEntries(db, { tenantId: ids.tenantId, search: "kouame" })).toHaveLength(3);
    expect(
      await listTimeEntries(db, {
        tenantId: ids.tenantId,
        from: MONDAY,
        to: addIsoDays(MONDAY, 1),
      }),
    ).toHaveLength(3);
    expect(await listTimeEntries(db, { tenantId: ids.tenantId, from: TUESDAY })).toHaveLength(0);

    const counters = await getTimeEntryCounters(db, ids.tenantId, MONDAY);
    expect(counters).toEqual({
      drafts: 1,
      validatedThisMonth: 2,
      absencesThisMonth: 1,
      workedHalfDaysThisMonth: 1,
      workedHoursThisMonth: 0,
      employeesPunchedThisMonth: 1,
    });

    const voisine = await getTimeEntryCounters(db, ids.otherTenantId, MONDAY);
    expect(voisine.drafts).toBe(0);
    expect(voisine.validatedThisMonth).toBe(0);
  });
});

describe("HR-011 — appui de la nouvelle ligue", () => {
  it("annonce la demi-journée attendue : calendrier de la fiche sinon celui de l'espace", async () => {
    const ids = await seedHrTenant(db, "attente");
    const shared = await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const own = await makeCalendar(ids, "Trois jours", {
      days: week(["monday", "tuesday", "wednesday"]),
    });
    const framed = await makeEmployee(ids, { workCalendarId: own });
    const colleague = await makeEmployee(ids);

    await makeHoliday(ids, THURSDAY, { kind: "unworked", period: "morning", label: "Chômé" });

    const expectation = await getPunchExpectation(db, ids.tenantId, {
      from: MONDAY,
      to: SUNDAY,
    });
    expect(expectation.defaultCalendarId).toBe(shared);
    expect(expectation.employeeCalendarIds[framed.id]).toBe(own);
    expect(expectation.employeeCalendarIds[colleague.id]).toBeNull();
    expect(expectation.holidaysByDate[THURSDAY]).toEqual(["morning"]);
    expect(expectation.calendars).toHaveLength(2);
    expect(expectation.calendars.find((calendar) => calendar.id === own)?.days).toHaveLength(7);

    const framedDay = await resolveDayCapacity(db, ids.tenantId, framed.id, THURSDAY);
    expect(framedDay.halfDays).toBe(0);
    const colleagueDay = await resolveDayCapacity(db, ids.tenantId, colleague.id, THURSDAY);
    expect(colleagueDay.halfDays).toBe(0.5);
    expect(colleagueDay.hours).toBe(3);
  });

  it("exclut les fiches sorties du rattachement annoncé", async () => {
    const ids = await seedHrTenant(db, "attente-sortie");
    const shared = await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const active = await makeEmployee(ids);
    const left = await makeEmployee(ids, { status: "left" });

    const expectation = await getPunchExpectation(db, ids.tenantId, { from: MONDAY, to: SUNDAY });
    expect(expectation.employeeCalendarIds[active.id]).toBeNull();
    expect(expectation.employeeCalendarIds[left.id]).toBeUndefined();
    expect(expectation.defaultCalendarId).toBe(shared);
  });
});

describe("HR-012 — modèle d'import des pointages", () => {
  it("expose six colonnes, les listes de saisie et un slug public", async () => {
    expect([...HR_TIME_ENTRY_HEADERS]).toEqual([
      "matricule",
      "date",
      "nature",
      "periode",
      "heures",
      "motif",
    ]);
    expect([...HEADERS_BY_KIND.hr_time_entries]).toEqual([...HR_TIME_ENTRY_HEADERS]);
    expect(IMPORT_TEMPLATE_PATHS.hr_time_entries).toBe("/api/modeles/pointages");
    expect(templateFileName("hr_time_entries")).toBe("lean-modele-pointages.xlsx");

    const workbook = await loadWorkbook(await buildTemplate("hr_time_entries"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

    const headers = HR_TIME_ENTRY_HEADERS.map(
      (_, index) => data?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...HR_TIME_ENTRY_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getColumn(2).numFmt).toBe("@");
    expect(data?.getCell("C2").dataValidation?.formulae).toEqual(['"Travaillé,Absence"']);
    expect(data?.getCell("D2").dataValidation?.formulae).toEqual([
      '"Journée,Matin,Après-midi,Heures"',
    ]);
  });
});

describe("HR-012 — analyse sans écriture", () => {
  it("bloque chaque ligne hors règle et ne pose aucun pointage", async () => {
    const ids = await seedHrTenant(db, "pointage-import-erreurs");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids, { code: "IMP1001" });
    await makeEmployee(ids, { code: "IMP1002", status: "left" });
    const alreadyValidated = await punch(ids, employee.id, THURSDAY, { period: "morning" });
    await setTimeEntryStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: alreadyValidated,
      status: "validated",
    });

    const rows = [
      timeRow(2, { matricule: "" }),
      timeRow(3, { matricule: "INCONNU" }),
      timeRow(4, { matricule: "IMP1002" }),
      timeRow(5, { date: FUTURE }),
      timeRow(6, { date: "03/11/2026" }),
      timeRow(7, { periode: "" }),
      timeRow(8, { nature: "Malade" }),
      timeRow(9, { periode: "Soir" }),
      timeRow(10, { date: SATURDAY }),
      timeRow(11, { periode: "Heures", heures: "8" }),
      timeRow(12, { date: TUESDAY }),
      timeRow(13, { date: TUESDAY }),
      timeRow(14, { date: THURSDAY, periode: "Matin" }),
      timeRow(15, { date: FRIDAY, nature: "Absence" }),
    ];

    const analysis = await analyzePointages(ids, rows, hashOf("pointage-import-erreurs"));
    expect(analysis.rowCount).toBe(14);
    expect(analysis.errorCount).toBe(13);
    expect(analysis.warningCount).toBe(0);
    expect(await entryCount(ids.tenantId)).toBe(1);

    const messages = await storedRows(ids, analysis.batchId);
    const joined = messages.map((row) => [...row.errors, ...row.warnings].join(" | "));
    expect(joined[0]).toContain("Matricule : obligatoire");
    expect(joined[1]).toContain("aucun salarié de cet espace ne le porte");
    expect(joined[2]).toContain("IMP1002 : ce salarié est sorti de l'effectif");
    expect(joined[3]).toContain("un pointage ne se saisit pas pour un jour futur");
    expect(joined[4]).toContain("AAAA-MM-JJ");
    expect(joined[5]).toContain("Période : obligatoire");
    expect(joined[6]).toContain("Nature : Travaillé ou Absence attendu");
    expect(joined[7]).toContain("Période : Journée, Matin, Après-midi ou Heures attendue");
    expect(joined[8]).toContain("demi-journée non travaillée au calendrier applicable");
    expect(joined[9]).toContain("8 heures dépassent les 7 heures que compte ce jour");
    expect(joined[10]).toBe("");
    expect(joined[11]).toContain("le fichier porte deux lignes pour ce salarié");
    expect(joined[11]).toContain("demi-journée(s) dépassent");
    expect(joined[12]).toContain("déjà validé");
    expect(joined[13]).toContain("une absence explique son motif");
    expect(await updateIdOf(analysis.batchId, 14)).toBeNull();

    await expect(applyBatch(ids, analysis.batchId)).rejects.toThrow(/en erreur/);
    expect(await entryCount(ids.tenantId)).toBe(1);
  });

  it("réclame un calendrier applicable avant toute saisie", async () => {
    const ids = await seedHrTenant(db, "pointage-import-calendrier");
    await makeEmployee(ids, { code: "IMP5001" });

    const analysis = await analyzePointages(
      ids,
      [timeRow(2, { matricule: "IMP5001" })],
      hashOf("pointage-import-calendrier"),
    );
    expect(analysis.errorCount).toBe(1);
    const [row] = await storedRows(ids, analysis.batchId);
    expect(row?.errors.join(" ")).toContain(
      "la fiche ne porte aucun calendrier et l'espace n'en a pas défini",
    );
    expect(await entryCount(ids.tenantId)).toBe(0);
  });

  it("avertit sur le brouillon repris et annonce ce que la confirmation écrira", async () => {
    const ids = await seedHrTenant(db, "pointage-import-avertissements");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids, { code: "IMP2001" });
    const draft = await punch(ids, employee.id, MONDAY, { period: "morning" });

    const analysis = await analyzePointages(
      ids,
      [
        timeRow(2, { matricule: "imp2001", periode: "Matin", nature: "" }),
        timeRow(3, { matricule: "IMP2001", periode: "Après-midi" }),
      ],
      hashOf("pointage-import-avertissements"),
    );

    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(1);
    expect(analysis.notes.join(" ")).toContain(
      "2 pointages seront écrits en brouillon, dont 1 sur un brouillon déjà posé, sans duplication",
    );
    expect(await entryCount(ids.tenantId)).toBe(1);

    const rows = await storedRows(ids, analysis.batchId);
    expect(rows.map((row) => row.status)).toEqual(["warning", "valid"]);
    expect(rows[0]?.warnings.join(" ")).toContain("normalisé en majuscules");
    expect(rows[0]?.warnings.join(" ")).toContain("Nature : vide");
    expect(rows[0]?.warnings.join(" ")).toContain(
      "la ligne reprend le pointage brouillon de cette période et le met à jour, sans le dupliquer",
    );
    expect(await updateIdOf(analysis.batchId, 2)).toBe(draft);
    expect(await updateIdOf(analysis.batchId, 3)).toBeNull();
  });
});

describe("HR-012 — application du lot de pointages", () => {
  it("écrit en brouillon, reprend le brouillon posé et audite le lot", async () => {
    const ids = await seedHrTenant(db, "pointage-import-application");
    const other = await seedHrTenant(db, "pointage-import-voisin");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    await makeCalendar(other, "Cinq jours voisin", { isDefault: true });
    const employee = await makeEmployee(ids, { code: "IMP3001" });
    const morningDraft = await punch(ids, employee.id, MONDAY, { period: "morning" });

    const rows = [
      timeRow(2, {
        matricule: "IMP3001",
        nature: "Absence",
        periode: "Matin",
        motif: "Rendez-vous médical",
      }),
      timeRow(3, { matricule: "IMP3001", periode: "Après-midi" }),
      timeRow(4, { matricule: "IMP3001", date: WEDNESDAY, periode: "Heures", heures: "4,5" }),
    ];
    const hash = hashOf("pointage-import-application");
    const analysis = await analyzePointages(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);

    const applied = await applyBatch(ids, analysis.batchId);
    expect(applied).toMatchObject({ kind: "hr_time_entries", written: 3 });

    const pointages = await entriesOf(employee.id);
    expect(pointages).toHaveLength(3);
    const morning = pointages.find((entry) => entry.period === "morning");
    expect(morning).toMatchObject({
      id: morningDraft,
      kind: "absence",
      note: "Rendez-vous médical",
      status: "draft",
    });
    expect(pointages.find((entry) => entry.period === "afternoon")).toMatchObject({
      workDate: MONDAY,
      kind: "worked",
      status: "draft",
    });
    expect(pointages.find((entry) => entry.period === "hours")).toMatchObject({
      workDate: WEDNESDAY,
      hours: "4.500000",
      status: "draft",
    });

    const linked = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linked).toHaveLength(3);
    expect(linked.map((row) => row.entityId)).toContain(morningDraft);

    expect((await auditActions(ids, "import_batch", analysis.batchId)).sort()).toEqual([
      "catalog.import.apply",
      "hr.time_entry.import",
    ]);
    const [audit] = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "hr.time_entry.import")),
      );
    expect(audit?.details).toMatchObject({ written: 3, updated: 1, employeeCodes: ["IMP3001"] });

    expect(await entryCount(other.tenantId)).toBe(0);

    await expect(applyBatch(ids, analysis.batchId)).rejects.toThrow(/déjà été appliqué/);

    const rejeu = await analyzePointages(ids, rows.slice(0, 1), hash);
    await expect(applyBatch(ids, rejeu.batchId)).rejects.toThrow(/déjà été importé en pointages/);
    expect(await entryCount(ids.tenantId)).toBe(3);
  });

  it("re-vérifie la base au moment de confirmer", async () => {
    const ids = await seedHrTenant(db, "pointage-import-concurrence");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    const employee = await makeEmployee(ids, { code: "IMP4001" });

    const analysis = await analyzePointages(
      ids,
      [timeRow(2, { matricule: "IMP4001" })],
      hashOf("pointage-import-concurrence"),
    );
    expect(analysis.errorCount).toBe(0);

    const posé = await punch(ids, employee.id, MONDAY);
    await expect(applyBatch(ids, analysis.batchId)).rejects.toThrow(
      /porte déjà un pointage brouillon pour cette période du jour/,
    );

    const pointages = await entriesOf(employee.id);
    expect(pointages).toHaveLength(1);
    expect(pointages[0]?.id).toBe(posé);
  });

  it("refuse les heures sur un jour férié du fichier", async () => {
    const ids = await seedHrTenant(db, "pointage-import-ferie");
    await makeCalendar(ids, "Cinq jours", { isDefault: true });
    await makeEmployee(ids, { code: "IMP6001" });
    await makeHoliday(ids, MONDAY, { label: "Fête importée" });

    const analysis = await analyzePointages(
      ids,
      [timeRow(2, { matricule: "IMP6001", periode: "Heures", heures: "1" })],
      hashOf("pointage-import-ferie"),
    );
    const [row] = await storedRows(ids, analysis.batchId);
    expect(row?.errors.join(" ")).toContain("ne compte aucune heure travaillée");
    expect(await entryCount(ids.tenantId)).toBe(0);
  });
});
