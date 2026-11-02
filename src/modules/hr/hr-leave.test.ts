import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, type HrCalendarDay } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import { HR_WEEK_DAYS } from "./constants";
import { HrError } from "./errors";
import { isLeaveRangeValid, leaveCoveredHalves, leaveCoveredPeriods } from "./leave";
import {
  createLeaveRequest,
  createLeaveType,
  deleteLeaveRequest,
  deleteLeaveType,
  getLeaveBalances,
  getLeaveCounters,
  getLeaveRequest,
  getLeaveType,
  leaveRequestTotalsBatch,
  leaveRequestTotalsFor,
  listLeaveRequests,
  listLeaveTypes,
  setLeaveRequestStatus,
  updateLeaveRequest,
  updateLeaveType,
} from "./leave-queries";
import { createEmployee, linkEmployeeUser } from "./queries";
import {
  createPublicHoliday,
  createTimeEntry,
  createWorkCalendar,
  resolveDayCapacity,
} from "./time-queries";
import type { CalendarDayRaw } from "./time-validation";
import { addIsoDays } from "./validation";

const TODAY = todayIsoDate();
/** Lundi de la semaine écoulée : ses six jours suivants restent dans le passé. */
const MONDAY = addIsoDays(TODAY, -(((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7) + 7));
const TUESDAY = addIsoDays(MONDAY, 1);
const WEDNESDAY = addIsoDays(MONDAY, 2);
const THURSDAY = addIsoDays(MONDAY, 3);
const YEAR = Number(MONDAY.slice(0, 4));

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

function week(workedDays: readonly HrCalendarDay[] = WORK_WEEK): Record<string, CalendarDayRaw> {
  const days: Record<string, CalendarDayRaw> = {};
  HR_WEEK_DAYS.forEach((dayOfWeek, index) => {
    const bounds = workedDays.includes(dayOfWeek) ? FULL_DAY : EMPTY_DAY;
    days[dayOfWeek] = { ...bounds, sequence: String(index + 1) };
  });
  return days;
}

async function makeDefaultCalendar(tenant: HrTenant): Promise<string> {
  const created = await createWorkCalendar(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: { name: "Semaine cinq jours", isDefault: true, days: week() },
  });
  return created.id;
}

let employeeCounter = 0;

async function makeEmployee(
  tenant: HrTenant,
  options: { code?: string; status?: string } = {},
): Promise<{ id: string; code: string }> {
  employeeCounter += 1;
  const code = options.code ?? `C${String(employeeCounter).padStart(6, "0")}`;
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
      workCalendarId: "",
    },
  });
  return { id: created.id, code };
}

let typeCounter = 0;

async function makeType(
  tenant: HrTenant,
  options: { code?: string; name?: string; allowance?: string; active?: boolean } = {},
): Promise<string> {
  typeCounter += 1;
  const created = await createLeaveType(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: {
      code: options.code ?? `CP${String(typeCounter).padStart(4, "0")}`,
      name: options.name ?? `Congé payé ${typeCounter}`,
      paid: true,
      halfDayAllowed: true,
      annualAllowanceDays: options.allowance ?? "20",
      active: options.active ?? true,
    },
  });
  return created.id;
}

function requestRaw(
  employeeId: string,
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  options: { startHalfDay?: string; endHalfDay?: string; reason?: string } = {},
) {
  return {
    employeeId,
    leaveTypeId,
    startDate,
    endDate,
    startHalfDay: options.startHalfDay ?? "morning",
    endHalfDay: options.endHalfDay ?? "afternoon",
    reason: options.reason ?? "",
  };
}

async function makeRequest(
  tenant: HrTenant,
  employeeId: string,
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  options: { startHalfDay?: string; endHalfDay?: string; reason?: string } = {},
): Promise<string> {
  const created = await createLeaveRequest(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: requestRaw(employeeId, leaveTypeId, startDate, endDate, options),
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

describe("HR-013 — types de congé paramétrables", () => {
  it("inscrit un type, normalise son code et le rend lisible", async () => {
    const ids = await seedHrTenant(db, "type-creation");
    const created = await createLeaveType(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        code: "conges payes".replace(" ", "_"),
        name: "Congé annuel payé",
        paid: true,
        halfDayAllowed: true,
        annualAllowanceDays: "24,5",
        active: true,
      },
    });

    const type = await getLeaveType(db, ids.tenantId, created.id);
    expect(type?.code).toBe("CONGES_PAYES");
    expect(type?.annualAllowanceDays).toBe("24.50");
    expect(type?.paid).toBe(true);
    expect(await auditActions(ids, "hr_leave_type", created.id)).toEqual(["hr.leave_type.create"]);
  });

  it("refuse un code invalide et un droit annuel hors bornes", async () => {
    const ids = await seedHrTenant(db, "type-validation");
    await expect(
      createLeaveType(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          code: "1",
          name: "Trop court",
          paid: true,
          halfDayAllowed: true,
          annualAllowanceDays: "10",
          active: true,
        },
      }),
    ).rejects.toThrow(HrError);
    await expect(
      createLeaveType(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          code: "SANS_SOLDE",
          name: "Hors bornes",
          paid: true,
          halfDayAllowed: true,
          annualAllowanceDays: "400",
          active: true,
        },
      }),
    ).rejects.toThrow(HrError);
    expect(await listLeaveTypes(db, ids.tenantId)).toHaveLength(0);
  });

  it("garde l'unicité du code et du nom dans l'espace", async () => {
    const ids = await seedHrTenant(db, "type-unicite");
    await makeType(ids, { code: "CP", name: "Congé payé" });
    await expect(makeType(ids, { code: "CP", name: "Autre nom" })).rejects.toThrow(HrError);
    await expect(makeType(ids, { code: "RTT", name: "Congé payé" })).rejects.toThrow(HrError);
  });

  it("met à jour un type et le désactive sans toucher aux demandes déjà posées", async () => {
    const ids = await seedHrTenant(db, "type-desactivation");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids, { code: "CP", name: "Congé payé", allowance: "20" });
    await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    await updateLeaveType(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      leaveTypeId: typeId,
      raw: {
        code: "CP",
        name: "Congé payé",
        paid: true,
        halfDayAllowed: true,
        annualAllowanceDays: "22",
        active: false,
      },
    });

    const type = await getLeaveType(db, ids.tenantId, typeId);
    expect(type?.active).toBe(false);
    expect(type?.annualAllowanceDays).toBe("22.00");
    expect(await auditActions(ids, "hr_leave_type", typeId)).toEqual([
      "hr.leave_type.create",
      "hr.leave_type.update",
    ]);
  });

  it("refuse de supprimer un type qui porte des demandes", async () => {
    const ids = await seedHrTenant(db, "type-suppression");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const used = await makeType(ids, { code: "CP", name: "Congé payé" });
    const free = await makeType(ids, { code: "RTT", name: "Récupération" });
    await makeRequest(ids, employee.id, used, MONDAY, MONDAY);

    await expect(
      deleteLeaveType(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        leaveTypeId: used,
      }),
    ).rejects.toThrow(HrError);

    await deleteLeaveType(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      leaveTypeId: free,
    });
    expect(await getLeaveType(db, ids.tenantId, free)).toBeNull();
  });

  it("isole les types par espace", async () => {
    const ids = await seedHrTenant(db, "type-isolation");
    const typeId = await makeType(ids, { code: "CP", name: "Congé payé" });
    expect(await getLeaveType(db, ids.otherTenantId, typeId)).toBeNull();
    expect(await listLeaveTypes(db, ids.otherTenantId)).toHaveLength(0);
  });
});

describe("HR-014 — demande posée en demi-journées", () => {
  it("borne la plage : une fin avant le début, ou un jour unique qui démarre l'après-midi", () => {
    expect(
      isLeaveRangeValid({
        startDate: MONDAY,
        endDate: MONDAY,
        startHalfDay: "morning",
        endHalfDay: "afternoon",
      }),
    ).toBe(true);
    expect(
      isLeaveRangeValid({
        startDate: MONDAY,
        endDate: MONDAY,
        startHalfDay: "afternoon",
        endHalfDay: "afternoon",
      }),
    ).toBe(true);
    expect(
      isLeaveRangeValid({
        startDate: MONDAY,
        endDate: MONDAY,
        startHalfDay: "afternoon",
        endHalfDay: "morning",
      }),
    ).toBe(false);
    expect(
      isLeaveRangeValid({
        startDate: TUESDAY,
        endDate: MONDAY,
        startHalfDay: "morning",
        endHalfDay: "afternoon",
      }),
    ).toBe(false);
  });

  it("réduit la couverture aux demi-journées voulues", () => {
    const range = {
      startDate: MONDAY,
      endDate: WEDNESDAY,
      startHalfDay: "afternoon" as const,
      endHalfDay: "morning" as const,
    };
    expect(leaveCoveredHalves(MONDAY, range)).toEqual(["afternoon"]);
    expect(leaveCoveredHalves(TUESDAY, range)).toEqual(["morning", "afternoon"]);
    expect(leaveCoveredHalves(WEDNESDAY, range)).toEqual(["morning"]);
    expect(leaveCoveredHalves(THURSDAY, range)).toEqual([]);
    expect(leaveCoveredPeriods(TUESDAY, range)).toEqual(["full"]);
    expect(leaveCoveredPeriods(MONDAY, range)).toEqual(["afternoon"]);
  });

  it("refuse une période vide à l'enregistrement", async () => {
    const ids = await seedHrTenant(db, "demande-periode");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    await expect(
      makeRequest(ids, employee.id, typeId, MONDAY, MONDAY, {
        startHalfDay: "afternoon",
        endHalfDay: "morning",
      }),
    ).rejects.toThrow(HrError);
  });

  it("refuse une demande pour un salarié sorti de l'effectif", async () => {
    const ids = await seedHrTenant(db, "demande-sorti");
    const employee = await makeEmployee(ids, { status: "left" });
    const typeId = await makeType(ids);
    await expect(makeRequest(ids, employee.id, typeId, MONDAY, MONDAY)).rejects.toThrow(HrError);
  });
});

describe("HR-015 — une seule demande active par demi-journée", () => {
  it("refuse deux demandes qui se recouvrent, brouillon ou validée", async () => {
    const ids = await seedHrTenant(db, "chevauchement");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);

    const first = await makeRequest(ids, employee.id, typeId, MONDAY, WEDNESDAY);
    await expect(makeRequest(ids, employee.id, typeId, WEDNESDAY, THURSDAY)).rejects.toThrow(
      HrError,
    );

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId: first,
      status: "validated",
    });
    await expect(makeRequest(ids, employee.id, typeId, MONDAY, MONDAY)).rejects.toThrow(HrError);
  });

  it("accepte deux demandes jointives sur des demi-journées distinctes", async () => {
    const ids = await seedHrTenant(db, "demande-jointive");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);

    await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY, {
      startHalfDay: "morning",
      endHalfDay: "morning",
    });
    await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY, {
      startHalfDay: "afternoon",
      endHalfDay: "afternoon",
    });

    expect(await listLeaveRequests(db, ids.tenantId, { employeeId: employee.id })).toHaveLength(2);
  });

  it("n'oppose pas les demandes de deux salariés différents", async () => {
    const ids = await seedHrTenant(db, "demande-deux-salaries");
    await makeDefaultCalendar(ids);
    const first = await makeEmployee(ids);
    const second = await makeEmployee(ids);
    const typeId = await makeType(ids);

    await makeRequest(ids, first.id, typeId, MONDAY, MONDAY);
    await makeRequest(ids, second.id, typeId, MONDAY, MONDAY);
    expect(await listLeaveRequests(db, ids.tenantId)).toHaveLength(2);
  });
});

describe("HR-016 — workflow brouillon, validé, refusé, annulé", () => {
  it("valide un brouillon, puis l'annule, en traçant chaque transition", async () => {
    const ids = await seedHrTenant(db, "workflow-transitions");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, TUESDAY);

    expect((await getLeaveRequest(db, ids.tenantId, requestId))?.status).toBe("draft");

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "validated",
    });
    const validated = await getLeaveRequest(db, ids.tenantId, requestId);
    expect(validated?.status).toBe("validated");
    expect(validated?.decidedAt).not.toBeNull();

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "cancelled",
    });
    expect((await getLeaveRequest(db, ids.tenantId, requestId))?.status).toBe("cancelled");

    expect(await auditActions(ids, "hr_leave_request", requestId)).toEqual([
      "hr.leave_request.create",
      "hr.leave_request.validate",
      "hr.leave_request.cancel",
    ]);
  });

  it("exige un motif pour un refus et garde les transitions hors chemin", async () => {
    const ids = await seedHrTenant(db, "workflow-refus");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    await expect(
      setLeaveRequestStatus(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        requestId,
        status: "refused",
      }),
    ).rejects.toThrow(HrError);

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "refused",
      decisionNote: "Effectif insuffisant sur la période.",
    });
    const refused = await getLeaveRequest(db, ids.tenantId, requestId);
    expect(refused?.status).toBe("refused");
    expect(refused?.decisionNote).toBe("Effectif insuffisant sur la période.");

    await expect(
      setLeaveRequestStatus(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        requestId,
        status: "validated",
      }),
    ).rejects.toThrow(HrError);
  });

  it("ne corrige et ne supprime qu'un brouillon", async () => {
    const ids = await seedHrTenant(db, "workflow-brouillon");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    await updateLeaveRequest(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      raw: requestRaw(employee.id, typeId, MONDAY, TUESDAY, { reason: "Voyage familial" }),
    });
    expect((await getLeaveRequest(db, ids.tenantId, requestId))?.reason).toBe("Voyage familial");

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "validated",
    });

    await expect(
      updateLeaveRequest(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        requestId,
        raw: requestRaw(employee.id, typeId, MONDAY, MONDAY),
      }),
    ).rejects.toThrow(HrError);
    await expect(
      deleteLeaveRequest(db, { tenantId: ids.tenantId, actorUserId: ids.userId, requestId }),
    ).rejects.toThrow(HrError);

    const draftId = await makeRequest(ids, employee.id, typeId, THURSDAY, THURSDAY);
    await deleteLeaveRequest(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId: draftId,
    });
    expect(await getLeaveRequest(db, ids.tenantId, draftId)).toBeNull();
    expect(await auditActions(ids, "hr_leave_request", draftId)).toEqual([
      "hr.leave_request.create",
      "hr.leave_request.delete",
    ]);
  });

  it("isole les demandes par espace", async () => {
    const ids = await seedHrTenant(db, "demande-isolation");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    expect(await getLeaveRequest(db, ids.otherTenantId, requestId)).toBeNull();
    expect(await listLeaveRequests(db, ids.otherTenantId)).toHaveLength(0);
  });
});

describe("HR-017 — un congé validé se déduit du travail attendu", () => {
  it("retire les demi-journées couvertes et laisse le brouillon sans effet", async () => {
    const ids = await seedHrTenant(db, "deduction-calendrier");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);

    const before = await resolveDayCapacity(db, ids.tenantId, employee.id, MONDAY);
    expect(before.halfDays).toBe(1);

    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);
    const whileDraft = await resolveDayCapacity(db, ids.tenantId, employee.id, MONDAY);
    expect(whileDraft.halfDays).toBe(1);
    expect(whileDraft.leavePeriods).toEqual([]);

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "validated",
    });
    const validated = await resolveDayCapacity(db, ids.tenantId, employee.id, MONDAY);
    expect(validated.leavePeriods).toEqual(["full"]);
    expect(validated.halfDays).toBe(0);
  });

  it("refuse un pointage sur une demi-journée couverte par un congé validé", async () => {
    const ids = await seedHrTenant(db, "deduction-pointage");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "validated",
    });

    await expect(
      createTimeEntry(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          employeeId: employee.id,
          workDate: MONDAY,
          kind: "worked",
          period: "full",
          hours: "",
          note: "",
        },
      }),
    ).rejects.toThrow(HrError);
  });

  it("chiffre ce qu'une demande retire, jours fériés compris", async () => {
    const ids = await seedHrTenant(db, "deduction-totaux");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    await createPublicHoliday(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { workDate: TUESDAY, kind: "public_holiday", period: "full", label: "Fête nationale" },
    });

    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, WEDNESDAY);
    const request = await getLeaveRequest(db, ids.tenantId, requestId);
    expect(request).not.toBeNull();
    if (!request) return;

    const totals = await leaveRequestTotalsFor(db, ids.tenantId, request);
    // Deux jours ouvrés (lundi et mercredi), le mardi étant déjà retiré par le férié.
    expect(totals.halfDays).toBe(4);
    expect(totals.hours).toBe(14);
    expect(totals.days).toBe(2);

    const batch = await leaveRequestTotalsBatch(db, ids.tenantId, [request]);
    expect(batch.get(requestId)?.halfDays).toBe(4);
  });
});

describe("HR-018 — solde et compteurs", () => {
  it("déduit les jours validés et les brouillons du droit annuel", async () => {
    const ids = await seedHrTenant(db, "solde-calcul");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids, { code: "CP", name: "Congé payé", allowance: "20" });

    const validated = await makeRequest(ids, employee.id, typeId, MONDAY, WEDNESDAY);
    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId: validated,
      status: "validated",
    });
    await makeRequest(ids, employee.id, typeId, THURSDAY, THURSDAY);

    const balances = await getLeaveBalances(db, ids.tenantId, { year: YEAR });
    const row = balances.find(
      (entry) => entry.employeeId === employee.id && entry.leaveTypeId === typeId,
    );
    expect(row?.allowanceDays).toBe(20);
    expect(row?.takenDays).toBe(3);
    expect(row?.pendingDays).toBe(1);
    expect(row?.availableDays).toBe(16);
  });

  it("compte les brouillons, les décisions de l'année et les absents du jour", async () => {
    const ids = await seedHrTenant(db, "solde-compteurs");
    await makeDefaultCalendar(ids);
    const away = await makeEmployee(ids);
    const refusedEmployee = await makeEmployee(ids);
    const draftEmployee = await makeEmployee(ids);
    const typeId = await makeType(ids);

    const validated = await makeRequest(ids, away.id, typeId, TODAY, TODAY);
    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId: validated,
      status: "validated",
    });
    const refused = await makeRequest(ids, refusedEmployee.id, typeId, TODAY, TODAY);
    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId: refused,
      status: "refused",
      decisionNote: "Période chargée.",
    });
    await makeRequest(ids, draftEmployee.id, typeId, MONDAY, MONDAY);

    const counters = await getLeaveCounters(db, ids.tenantId, TODAY);
    expect(counters.drafts).toBe(1);
    expect(counters.validatedThisYear).toBe(1);
    expect(counters.refusedThisYear).toBe(1);
    expect(counters.cancelledThisYear).toBe(0);
    expect(counters.awayToday).toBe(1);
    expect(counters.activeTypes).toBe(1);
  });

  it("filtre la liste par année, statut, salarié et type", async () => {
    const ids = await seedHrTenant(db, "liste-filtres");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const otherType = await makeType(ids, { code: "RTT", name: "Récupération" });
    const cpType = await makeType(ids, { code: "CP", name: "Congé payé" });

    const requestId = await makeRequest(ids, employee.id, cpType, MONDAY, MONDAY);
    await makeRequest(ids, employee.id, otherType, TUESDAY, TUESDAY);
    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      requestId,
      status: "validated",
    });

    expect(await listLeaveRequests(db, ids.tenantId, { year: YEAR })).toHaveLength(2);
    expect(await listLeaveRequests(db, ids.tenantId, { status: "validated" })).toHaveLength(1);
    expect(await listLeaveRequests(db, ids.tenantId, { employeeId: employee.id })).toHaveLength(2);
    expect(await listLeaveRequests(db, ids.tenantId, { leaveTypeId: cpType })).toHaveLength(1);
    expect(await listLeaveRequests(db, ids.tenantId, { year: YEAR - 5 })).toHaveLength(0);
  });
});

describe("HR-019 — l'auteur ne valide pas sa propre demande", () => {
  it("refuse la validation par le compte rattaché au salarié et l'accepte d'un tiers", async () => {
    const ids = await seedHrTenant(db, "auto-validation");
    await makeDefaultCalendar(ids);
    const employee = await makeEmployee(ids);
    const typeId = await makeType(ids);
    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      userId: ids.userId,
    });
    const requestId = await makeRequest(ids, employee.id, typeId, MONDAY, MONDAY);

    await expect(
      setLeaveRequestStatus(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        requestId,
        status: "validated",
      }),
    ).rejects.toThrow(HrError);
    expect((await getLeaveRequest(db, ids.tenantId, requestId))?.status).toBe("draft");

    await setLeaveRequestStatus(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.otherUserId,
      requestId,
      status: "validated",
    });
    const validated = await getLeaveRequest(db, ids.tenantId, requestId);
    expect(validated?.status).toBe("validated");
    expect(await auditActions(ids, "hr_leave_request", requestId)).toEqual([
      "hr.leave_request.create",
      "hr.leave_request.validate",
    ]);
  });
});
