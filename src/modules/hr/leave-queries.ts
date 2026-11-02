import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrEmployees,
  hrLeaveRequests,
  hrLeaveTypes,
  type HrLeaveHalfDay,
  type HrLeaveRequestStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { HR_LIST_LIMIT } from "./constants";
import { HrError } from "./errors";
import {
  leaveCoveredHalves,
  leaveRequestTotals,
  leaveRangesOverlap,
  type LeaveDayCapacity,
  type LeaveRange,
  type LeaveTotals,
} from "./leave";
import { validateLeaveRequestInput, validateLeaveTypeInput } from "./leave-validation";
import { employeeDayCapacities } from "./time-queries";
import { employeeFullName } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Transaction;

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

/* --------------------------------------------------------- types de congés (HR-013) */

export interface LeaveTypeRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly paid: boolean;
  readonly halfDayAllowed: boolean;
  readonly annualAllowanceDays: string;
  readonly active: boolean;
}

const LEAVE_TYPE_COLUMNS = {
  id: hrLeaveTypes.id,
  code: hrLeaveTypes.code,
  name: hrLeaveTypes.name,
  paid: hrLeaveTypes.paid,
  halfDayAllowed: hrLeaveTypes.halfDayAllowed,
  annualAllowanceDays: hrLeaveTypes.annualAllowanceDays,
  active: hrLeaveTypes.active,
};

export async function listLeaveTypes(
  db: Database,
  tenantId: string,
  input: { readonly activeOnly?: boolean } = {},
): Promise<readonly LeaveTypeRow[]> {
  const parts = [eq(hrLeaveTypes.tenantId, tenantId)];
  if (input.activeOnly) {
    parts.push(eq(hrLeaveTypes.active, true));
  }
  return db
    .select(LEAVE_TYPE_COLUMNS)
    .from(hrLeaveTypes)
    .where(and(...parts))
    .orderBy(asc(hrLeaveTypes.code))
    .limit(HR_LIST_LIMIT);
}

export async function getLeaveType(
  db: Database,
  tenantId: string,
  leaveTypeId: string,
): Promise<LeaveTypeRow | null> {
  const [row] = await db
    .select(LEAVE_TYPE_COLUMNS)
    .from(hrLeaveTypes)
    .where(and(eq(hrLeaveTypes.tenantId, tenantId), eq(hrLeaveTypes.id, leaveTypeId)))
    .limit(1);
  return row ?? null;
}

async function lockLeaveType(
  tx: Transaction,
  tenantId: string,
  leaveTypeId: string,
): Promise<LeaveTypeRow> {
  const [row] = await tx
    .select(LEAVE_TYPE_COLUMNS)
    .from(hrLeaveTypes)
    .where(and(eq(hrLeaveTypes.tenantId, tenantId), eq(hrLeaveTypes.id, leaveTypeId)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Type de congé introuvable dans cet espace.");
  }
  return row;
}

export async function createLeaveType(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateLeaveTypeInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateLeaveTypeInput(input.raw), "Type de congé invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hrLeaveTypes)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          name: data.name,
          paid: data.paid,
          halfDayAllowed: data.halfDayAllowed,
          annualAllowanceDays: data.annualAllowanceDays,
          active: data.active,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrLeaveTypes.id });
      if (!created) {
        rethrow("Le type de congé n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.leave_type.create",
        entityType: "hr_leave_type",
        entityId: created.id,
        details: {
          code: data.code,
          name: data.name,
          paid: data.paid,
          halfDayAllowed: data.halfDayAllowed,
          annualAllowanceDays: data.annualAllowanceDays,
          active: data.active,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow("Ce code ou ce nom de type de congé est déjà pris dans cet espace.");
    }
    throw error;
  }
}

export async function updateLeaveType(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly leaveTypeId: string;
    readonly raw: Parameters<typeof validateLeaveTypeInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateLeaveTypeInput(input.raw), "Type de congé invalide.");
  try {
    await db.transaction(async (tx) => {
      const before = await lockLeaveType(tx, input.tenantId, input.leaveTypeId);
      await tx
        .update(hrLeaveTypes)
        .set({
          code: data.code,
          name: data.name,
          paid: data.paid,
          halfDayAllowed: data.halfDayAllowed,
          annualAllowanceDays: data.annualAllowanceDays,
          active: data.active,
          updatedByUserId: input.actorUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(hrLeaveTypes.tenantId, input.tenantId), eq(hrLeaveTypes.id, before.id)));
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.leave_type.update",
        entityType: "hr_leave_type",
        entityId: before.id,
        details: {
          before: {
            code: before.code,
            name: before.name,
            annualAllowanceDays: before.annualAllowanceDays,
            active: before.active,
          },
          after: {
            code: data.code,
            name: data.name,
            annualAllowanceDays: data.annualAllowanceDays,
            active: data.active,
          },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow("Ce code ou ce nom de type de congé est déjà pris dans cet espace.");
    }
    throw error;
  }
}

export async function deleteLeaveType(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly leaveTypeId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockLeaveType(tx, input.tenantId, input.leaveTypeId);
    const usage = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(hrLeaveRequests)
      .where(
        and(
          eq(hrLeaveRequests.tenantId, input.tenantId),
          eq(hrLeaveRequests.leaveTypeId, before.id),
        ),
      );
    const total = Number(usage[0]?.total ?? 0);
    if (total > 0) {
      rethrow(
        `« ${before.name} » porte ${total} demande(s) : désactivez-le au lieu de le supprimer.`,
      );
    }
    await tx
      .delete(hrLeaveTypes)
      .where(and(eq(hrLeaveTypes.tenantId, input.tenantId), eq(hrLeaveTypes.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.leave_type.delete",
      entityType: "hr_leave_type",
      entityId: before.id,
      details: { code: before.code, name: before.name },
    });
  });
}

/* ------------------------------------------------------ demandes de congé (HR-014) */

export interface LeaveRequestRow {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly leaveTypePaid: boolean;
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: HrLeaveHalfDay;
  readonly endHalfDay: HrLeaveHalfDay;
  readonly reason: string | null;
  readonly status: HrLeaveRequestStatus;
  readonly decisionNote: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

const LEAVE_REQUEST_COLUMNS = {
  id: hrLeaveRequests.id,
  employeeId: hrLeaveRequests.employeeId,
  employeeCode: hrEmployees.code,
  lastName: hrEmployees.lastName,
  firstName: hrEmployees.firstName,
  leaveTypeId: hrLeaveRequests.leaveTypeId,
  leaveTypeCode: hrLeaveTypes.code,
  leaveTypeName: hrLeaveTypes.name,
  leaveTypePaid: hrLeaveTypes.paid,
  startDate: hrLeaveRequests.startDate,
  endDate: hrLeaveRequests.endDate,
  startHalfDay: hrLeaveRequests.startHalfDay,
  endHalfDay: hrLeaveRequests.endHalfDay,
  reason: hrLeaveRequests.reason,
  status: hrLeaveRequests.status,
  decisionNote: hrLeaveRequests.decisionNote,
  decidedAt: hrLeaveRequests.decidedAt,
  createdAt: hrLeaveRequests.createdAt,
};

function toLeaveRequestRow(row: {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly leaveTypePaid: boolean;
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: string;
  readonly endHalfDay: string;
  readonly reason: string | null;
  readonly status: string;
  readonly decisionNote: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}): LeaveRequestRow {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: employeeFullName(row.lastName, row.firstName),
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    leaveTypePaid: row.leaveTypePaid,
    startDate: row.startDate,
    endDate: row.endDate,
    startHalfDay: row.startHalfDay as HrLeaveHalfDay,
    endHalfDay: row.endHalfDay as HrLeaveHalfDay,
    reason: row.reason,
    status: row.status as HrLeaveRequestStatus,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

export interface LeaveRequestFilters {
  readonly employeeId?: string;
  readonly leaveTypeId?: string;
  readonly status?: HrLeaveRequestStatus;
  readonly year?: number | null;
  readonly limit?: number;
}

function leaveRequestFilters(tenantId: string, filters: LeaveRequestFilters): SQL[] {
  const parts: SQL[] = [eq(hrLeaveRequests.tenantId, tenantId)];
  if (filters.employeeId) {
    parts.push(eq(hrLeaveRequests.employeeId, filters.employeeId));
  }
  if (filters.leaveTypeId) {
    parts.push(eq(hrLeaveRequests.leaveTypeId, filters.leaveTypeId));
  }
  if (filters.status) {
    parts.push(eq(hrLeaveRequests.status, filters.status));
  }
  if (filters.year) {
    parts.push(sql`EXTRACT(year FROM ${hrLeaveRequests.startDate}) = ${filters.year}`);
  }
  return parts;
}

export async function listLeaveRequests(
  db: Database,
  tenantId: string,
  filters: LeaveRequestFilters = {},
): Promise<readonly LeaveRequestRow[]> {
  const rows = await db
    .select(LEAVE_REQUEST_COLUMNS)
    .from(hrLeaveRequests)
    .innerJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
    .innerJoin(hrLeaveTypes, eq(hrLeaveTypes.id, hrLeaveRequests.leaveTypeId))
    .where(and(...leaveRequestFilters(tenantId, filters)))
    .orderBy(desc(hrLeaveRequests.startDate), asc(hrEmployees.code))
    .limit(filters.limit ?? HR_LIST_LIMIT);
  return rows.map(toLeaveRequestRow);
}

export async function getLeaveRequest(
  db: Database,
  tenantId: string,
  requestId: string,
): Promise<LeaveRequestRow | null> {
  const [row] = await db
    .select(LEAVE_REQUEST_COLUMNS)
    .from(hrLeaveRequests)
    .innerJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
    .innerJoin(hrLeaveTypes, eq(hrLeaveTypes.id, hrLeaveRequests.leaveTypeId))
    .where(and(eq(hrLeaveRequests.tenantId, tenantId), eq(hrLeaveRequests.id, requestId)))
    .limit(1);
  return row ? toLeaveRequestRow(row) : null;
}

/** HR-014 — ce que la demande retire au calendrier du salarié, chiffré sur sa fenêtre. */
export async function leaveRequestTotalsFor(
  db: Database,
  tenantId: string,
  request: Pick<
    LeaveRequestRow,
    "employeeId" | "startDate" | "endDate" | "startHalfDay" | "endHalfDay"
  >,
): Promise<LeaveTotals> {
  const capacities = await employeeDayCapacities(
    db,
    tenantId,
    request.employeeId,
    request.startDate,
    request.endDate,
  );
  return leaveRequestTotals(
    {
      startDate: request.startDate,
      endDate: request.endDate,
      startHalfDay: request.startHalfDay,
      endHalfDay: request.endHalfDay,
    },
    capacities,
  );
}

/**
 * HR-014 — les totaux de plusieurs demandes : les capacités se lisent une seule fois par salarié,
 * sur la fenêtre qui couvre ses demandes, pour que la liste reste tenable au-delà de quelques lignes.
 */
export async function leaveRequestTotalsBatch(
  db: Database,
  tenantId: string,
  requests: readonly Pick<
    LeaveRequestRow,
    "id" | "employeeId" | "startDate" | "endDate" | "startHalfDay" | "endHalfDay"
  >[],
): Promise<Map<string, LeaveTotals>> {
  const windows = new Map<string, { from: string; to: string }>();
  for (const request of requests) {
    const current = windows.get(request.employeeId);
    if (!current) {
      windows.set(request.employeeId, { from: request.startDate, to: request.endDate });
      continue;
    }
    if (request.startDate < current.from) {
      current.from = request.startDate;
    }
    if (request.endDate > current.to) {
      current.to = request.endDate;
    }
  }

  const capacities = new Map<string, readonly LeaveDayCapacity[]>();
  for (const [employeeId, window] of windows) {
    capacities.set(
      employeeId,
      await employeeDayCapacities(db, tenantId, employeeId, window.from, window.to),
    );
  }

  const totals = new Map<string, LeaveTotals>();
  for (const request of requests) {
    totals.set(
      request.id,
      leaveRequestTotals(
        {
          startDate: request.startDate,
          endDate: request.endDate,
          startHalfDay: request.startHalfDay,
          endHalfDay: request.endHalfDay,
        },
        capacities.get(request.employeeId) ?? [],
      ),
    );
  }
  return totals;
}

function rangeOf(row: {
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: HrLeaveHalfDay;
  readonly endHalfDay: HrLeaveHalfDay;
}): LeaveRange {
  return {
    startDate: row.startDate,
    endDate: row.endDate,
    startHalfDay: row.startHalfDay,
    endHalfDay: row.endHalfDay,
  };
}

/** HR-015 — une seule demande active par salarié et par demi-journée. */
async function assertNoOverlap(
  tx: DbLike,
  tenantId: string,
  employeeId: string,
  range: LeaveRange,
  excludeRequestId: string | null,
): Promise<void> {
  const rows = await tx
    .select({
      startDate: hrLeaveRequests.startDate,
      endDate: hrLeaveRequests.endDate,
      startHalfDay: hrLeaveRequests.startHalfDay,
      endHalfDay: hrLeaveRequests.endHalfDay,
    })
    .from(hrLeaveRequests)
    .where(
      and(
        eq(hrLeaveRequests.tenantId, tenantId),
        eq(hrLeaveRequests.employeeId, employeeId),
        inArray(hrLeaveRequests.status, ["draft", "validated"]),
        lte(hrLeaveRequests.startDate, range.endDate),
        gte(hrLeaveRequests.endDate, range.startDate),
        excludeRequestId ? ne(hrLeaveRequests.id, excludeRequestId) : undefined,
      ),
    );
  for (const row of rows) {
    if (leaveRangesOverlap(employeeId, employeeId, toRowRange(row), range)) {
      rethrow(
        `Ce salarié a déjà une demande de congé qui recouvre la période, du ${row.startDate} au ${row.endDate}.`,
      );
    }
  }
}

function toRowRange(row: {
  readonly startDate: string;
  readonly endDate: string;
  readonly startHalfDay: string;
  readonly endHalfDay: string;
}): LeaveRange {
  return {
    startDate: row.startDate,
    endDate: row.endDate,
    startHalfDay: row.startHalfDay as HrLeaveHalfDay,
    endHalfDay: row.endHalfDay as HrLeaveHalfDay,
  };
}

async function requireActiveLeaveType(
  tx: DbLike,
  tenantId: string,
  leaveTypeId: string,
): Promise<{ id: string; name: string }> {
  const [row] = await tx
    .select({ id: hrLeaveTypes.id, name: hrLeaveTypes.name, active: hrLeaveTypes.active })
    .from(hrLeaveTypes)
    .where(and(eq(hrLeaveTypes.tenantId, tenantId), eq(hrLeaveTypes.id, leaveTypeId)))
    .limit(1);
  if (!row) {
    rethrow("Type de congé introuvable dans cet espace.");
  }
  if (!row.active) {
    rethrow(`« ${row.name} » est désactivé : choisissez un type de congé actif.`);
  }
  return { id: row.id, name: row.name };
}

async function requireLeaveEmployee(
  tx: DbLike,
  tenantId: string,
  employeeId: string,
): Promise<{ id: string; code: string }> {
  const [row] = await tx
    .select({ id: hrEmployees.id, code: hrEmployees.code, status: hrEmployees.status })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, employeeId)))
    .limit(1);
  if (!row) {
    rethrow("Salarié introuvable dans cet espace.");
  }
  if (row.status === "left") {
    rethrow(
      `${row.code} : ce salarié est sorti de l'effectif, aucune demande ne s'ouvre pour lui.`,
    );
  }
  return { id: row.id, code: row.code };
}

function requestAuditDetails(
  employeeCode: string,
  data: {
    readonly leaveTypeId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly startHalfDay: HrLeaveHalfDay;
    readonly endHalfDay: HrLeaveHalfDay;
    readonly reason: string | null;
  },
): Record<string, unknown> {
  return {
    employeeCode,
    leaveTypeId: data.leaveTypeId,
    startDate: data.startDate,
    endDate: data.endDate,
    startHalfDay: data.startHalfDay,
    endHalfDay: data.endHalfDay,
    reason: data.reason,
  };
}

export async function createLeaveRequest(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateLeaveRequestInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateLeaveRequestInput(input.raw), "Demande de congé invalide.");
  return db.transaction(async (tx) => {
    const employee = await requireLeaveEmployee(tx, input.tenantId, data.employeeId);
    await requireActiveLeaveType(tx, input.tenantId, data.leaveTypeId);
    await assertNoOverlap(tx, input.tenantId, employee.id, rangeOf(data), null);
    const [created] = await tx
      .insert(hrLeaveRequests)
      .values({
        tenantId: input.tenantId,
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate: data.startDate,
        endDate: data.endDate,
        startHalfDay: data.startHalfDay,
        endHalfDay: data.endHalfDay,
        reason: data.reason,
        status: "draft",
        createdByUserId: input.actorUserId,
      })
      .returning({ id: hrLeaveRequests.id });
    if (!created) {
      rethrow("La demande de congé n'a pas pu être créée.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.leave_request.create",
      entityType: "hr_leave_request",
      entityId: created.id,
      details: requestAuditDetails(employee.code, data),
    });
    return created;
  });
}

async function lockLeaveRequest(
  tx: Transaction,
  tenantId: string,
  requestId: string,
): Promise<LeaveRequestRow> {
  const [locked] = await tx
    .select({ id: hrLeaveRequests.id })
    .from(hrLeaveRequests)
    .where(and(eq(hrLeaveRequests.tenantId, tenantId), eq(hrLeaveRequests.id, requestId)))
    .limit(1)
    .for("update");
  if (!locked) {
    rethrow("Demande de congé introuvable dans cet espace.");
  }
  const [row] = await tx
    .select(LEAVE_REQUEST_COLUMNS)
    .from(hrLeaveRequests)
    .innerJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
    .innerJoin(hrLeaveTypes, eq(hrLeaveTypes.id, hrLeaveRequests.leaveTypeId))
    .where(and(eq(hrLeaveRequests.tenantId, tenantId), eq(hrLeaveRequests.id, locked.id)))
    .limit(1);
  if (!row) {
    rethrow("Demande de congé introuvable dans cet espace.");
  }
  return toLeaveRequestRow(row);
}

export async function updateLeaveRequest(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly raw: Parameters<typeof validateLeaveRequestInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateLeaveRequestInput(input.raw), "Demande de congé invalide.");
  await db.transaction(async (tx) => {
    const before = await lockLeaveRequest(tx, input.tenantId, input.requestId);
    if (before.status !== "draft") {
      rethrow("Demande figée : elle a quitté le brouillon. Créez-en une nouvelle pour corriger.");
    }
    const employee = await requireLeaveEmployee(tx, input.tenantId, data.employeeId);
    await requireActiveLeaveType(tx, input.tenantId, data.leaveTypeId);
    await assertNoOverlap(tx, input.tenantId, employee.id, rangeOf(data), before.id);
    await tx
      .update(hrLeaveRequests)
      .set({
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate: data.startDate,
        endDate: data.endDate,
        startHalfDay: data.startHalfDay,
        endHalfDay: data.endHalfDay,
        reason: data.reason,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(hrLeaveRequests.tenantId, input.tenantId), eq(hrLeaveRequests.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.leave_request.update",
      entityType: "hr_leave_request",
      entityId: before.id,
      details: {
        ...requestAuditDetails(employee.code, data),
        before: {
          employeeCode: before.employeeCode,
          leaveTypeId: before.leaveTypeId,
          startDate: before.startDate,
          endDate: before.endDate,
        },
      },
    });
  });
}

const ALLOWED_TRANSITIONS: Record<HrLeaveRequestStatus, readonly HrLeaveRequestStatus[]> = {
  draft: ["validated", "refused", "cancelled"],
  validated: ["cancelled"],
  refused: [],
  cancelled: [],
};

const STATUS_ACTION: Record<HrLeaveRequestStatus, string> = {
  draft: "hr.leave_request.create",
  validated: "hr.leave_request.validate",
  refused: "hr.leave_request.refuse",
  cancelled: "hr.leave_request.cancel",
};

/**
 * HR-019 — un membre ne valide pas sa propre demande : le compte rattaché à la fiche du salarié
 * ne peut pas être celui qui décide.
 */
async function assertNotSelfValidation(
  tx: DbLike,
  tenantId: string,
  employeeId: string,
  actorUserId: string,
): Promise<void> {
  const [row] = await tx
    .select({ userId: hrEmployees.userId })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, employeeId)))
    .limit(1);
  if (row?.userId && row.userId === actorUserId) {
    rethrow("Un membre ne valide pas sa propre demande de congé : la décision revient à un tiers.");
  }
}

/** HR-016 — le workflow brouillon vers validé, refusé ou annulé, sous gestion. */
export async function setLeaveRequestStatus(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly status: HrLeaveRequestStatus;
    readonly decisionNote?: string | null;
  },
): Promise<void> {
  const note = input.decisionNote?.trim() ?? "";
  if (input.status === "refused" && note.length === 0) {
    rethrow("Refus : indiquez le motif de la décision.");
  }
  if (note.length > 200) {
    rethrow("Motif de décision : 200 caractères maximum.");
  }
  await db.transaction(async (tx) => {
    const before = await lockLeaveRequest(tx, input.tenantId, input.requestId);
    if (before.status === input.status) {
      return;
    }
    if (!ALLOWED_TRANSITIONS[before.status].includes(input.status)) {
      rethrow("Changement d'état impossible depuis le statut actuel.");
    }
    if (input.status === "validated") {
      await assertNotSelfValidation(tx, input.tenantId, before.employeeId, input.actorUserId);
    }
    await tx
      .update(hrLeaveRequests)
      .set({
        status: input.status,
        decidedByUserId: input.actorUserId,
        decidedAt: new Date(),
        decisionNote: note.length > 0 ? note : before.decisionNote,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(hrLeaveRequests.tenantId, input.tenantId), eq(hrLeaveRequests.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: STATUS_ACTION[input.status],
      entityType: "hr_leave_request",
      entityId: before.id,
      details: {
        employeeCode: before.employeeCode,
        startDate: before.startDate,
        endDate: before.endDate,
        before: { status: before.status },
        after: { status: input.status, decisionNote: note.length > 0 ? note : null },
      },
    });
  });
}

export async function deleteLeaveRequest(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly requestId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockLeaveRequest(tx, input.tenantId, input.requestId);
    if (before.status !== "draft") {
      rethrow("Seule une demande brouillon se supprime. Annulez une demande déjà traitée.");
    }
    await tx
      .delete(hrLeaveRequests)
      .where(and(eq(hrLeaveRequests.tenantId, input.tenantId), eq(hrLeaveRequests.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.leave_request.delete",
      entityType: "hr_leave_request",
      entityId: before.id,
      details: {
        employeeCode: before.employeeCode,
        startDate: before.startDate,
        endDate: before.endDate,
      },
    });
  });
}

/* --------------------------------------------------------------- soldes et compteurs */

export interface LeaveBalanceRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly allowanceDays: number;
  readonly takenDays: number;
  readonly pendingDays: number;
  readonly availableDays: number;
}

function roundDays(value: number): number {
  return Math.round(value * 100) / 100;
}

/** HR-018 — les soldes d'une année : droit annuel du type, jours posés validés et brouillons, reste.
 * Les jours posés se comptent comme ce que la demande retire au calendrier du salarié.
 */
export async function getLeaveBalances(
  db: Database,
  tenantId: string,
  input: { readonly year: number },
): Promise<readonly LeaveBalanceRow[]> {
  const from = `${input.year}-01-01`;
  const to = `${input.year}-12-31`;
  const [types, employees, requests] = await Promise.all([
    listLeaveTypes(db, tenantId),
    db
      .select({
        id: hrEmployees.id,
        code: hrEmployees.code,
        lastName: hrEmployees.lastName,
        firstName: hrEmployees.firstName,
      })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, tenantId), ne(hrEmployees.status, "left")))
      .orderBy(asc(hrEmployees.code))
      .limit(HR_LIST_LIMIT),
    db
      .select({
        employeeId: hrLeaveRequests.employeeId,
        leaveTypeId: hrLeaveRequests.leaveTypeId,
        startDate: hrLeaveRequests.startDate,
        endDate: hrLeaveRequests.endDate,
        startHalfDay: hrLeaveRequests.startHalfDay,
        endHalfDay: hrLeaveRequests.endHalfDay,
        status: hrLeaveRequests.status,
      })
      .from(hrLeaveRequests)
      .where(
        and(
          eq(hrLeaveRequests.tenantId, tenantId),
          inArray(hrLeaveRequests.status, ["draft", "validated"]),
          lte(hrLeaveRequests.startDate, to),
          gte(hrLeaveRequests.endDate, from),
        ),
      ),
  ]);

  const employeesWithRequests = new Set(requests.map((row) => row.employeeId));
  const capacitiesByEmployee = new Map<string, Awaited<ReturnType<typeof employeeDayCapacities>>>();
  for (const employee of employees) {
    if (!employeesWithRequests.has(employee.id)) {
      continue;
    }
    capacitiesByEmployee.set(
      employee.id,
      await employeeDayCapacities(db, tenantId, employee.id, from, to),
    );
  }

  const takenByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  for (const request of requests) {
    const capacities = capacitiesByEmployee.get(request.employeeId) ?? [];
    const totals = leaveRequestTotals(
      {
        startDate: request.startDate,
        endDate: request.endDate,
        startHalfDay: request.startHalfDay as HrLeaveHalfDay,
        endHalfDay: request.endHalfDay as HrLeaveHalfDay,
      },
      capacities,
    );
    const days = totals.halfDays / 2;
    const key = `${request.employeeId}|${request.leaveTypeId}`;
    const target = request.status === "validated" ? takenByKey : pendingByKey;
    target.set(key, (target.get(key) ?? 0) + days);
  }

  const rows: LeaveBalanceRow[] = [];
  for (const employee of employees) {
    for (const type of types) {
      const key = `${employee.id}|${type.id}`;
      const taken = roundDays(takenByKey.get(key) ?? 0);
      const pending = roundDays(pendingByKey.get(key) ?? 0);
      const allowance = Number(type.annualAllowanceDays);
      if (allowance <= 0 && taken === 0 && pending === 0) {
        continue;
      }
      rows.push({
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employeeFullName(employee.lastName, employee.firstName),
        leaveTypeId: type.id,
        leaveTypeCode: type.code,
        leaveTypeName: type.name,
        allowanceDays: allowance,
        takenDays: taken,
        pendingDays: pending,
        availableDays: roundDays(allowance - taken - pending),
      });
    }
  }
  return rows;
}

export interface LeaveCounters {
  readonly drafts: number;
  readonly validatedThisYear: number;
  readonly refusedThisYear: number;
  readonly cancelledThisYear: number;
  readonly awayToday: number;
  readonly types: number;
  readonly activeTypes: number;
}

export async function getLeaveCounters(
  db: Database,
  tenantId: string,
  today?: string,
): Promise<LeaveCounters> {
  const day = today ?? todayIsoDate();
  const year = Number(day.slice(0, 4));
  const [rows, types] = await Promise.all([
    db
      .select({
        employeeId: hrLeaveRequests.employeeId,
        status: hrLeaveRequests.status,
        startDate: hrLeaveRequests.startDate,
        endDate: hrLeaveRequests.endDate,
        startHalfDay: hrLeaveRequests.startHalfDay,
        endHalfDay: hrLeaveRequests.endHalfDay,
      })
      .from(hrLeaveRequests)
      .where(eq(hrLeaveRequests.tenantId, tenantId)),
    listLeaveTypes(db, tenantId),
  ]);

  let drafts = 0;
  let validatedThisYear = 0;
  let refusedThisYear = 0;
  let cancelledThisYear = 0;
  const away = new Set<string>();
  for (const row of rows) {
    if (row.status === "draft") {
      drafts += 1;
    }
    if (Number(row.startDate.slice(0, 4)) === year) {
      if (row.status === "validated") {
        validatedThisYear += 1;
      } else if (row.status === "refused") {
        refusedThisYear += 1;
      } else if (row.status === "cancelled") {
        cancelledThisYear += 1;
      }
    }
    if (row.status !== "validated") {
      continue;
    }
    const range = toRowRange(row);
    const covered = leaveCoveredHalves(day, range);
    if (covered.length > 0) {
      away.add(row.employeeId);
    }
  }

  return {
    drafts,
    validatedThisYear,
    refusedThisYear,
    cancelledThisYear,
    awayToday: away.size,
    types: types.length,
    activeTypes: types.filter((type) => type.active).length,
  };
}
