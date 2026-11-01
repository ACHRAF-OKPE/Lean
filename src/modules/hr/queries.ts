import { and, asc, count, desc, eq, gte, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrContracts,
  hrDepartments,
  hrEmployees,
  hrWorkCalendars,
  memberships,
  users,
  type HrContractKind,
  type HrContractStatus,
  type HrEmployeeStatus,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  HR_CONTRACT_DISPLAY_LABELS,
  HR_CONTRACT_KIND_LABELS,
  HR_EMPLOYEE_STATUS_LABELS,
  HR_LIST_LIMIT,
  MAX_DEPARTMENT_DEPTH,
  type HrContractDisplayStatus,
} from "./constants";
import { HrError } from "./errors";
import {
  addIsoDays,
  contractDisplayStatus,
  employeeFullName,
  validateContractInput,
  validateDepartmentInput,
  validateEmployeeInput,
} from "./validation";

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

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function rethrow(message: string): never {
  throw new HrError(message);
}

/* ------------------------------------------------------------------ services */

export interface DepartmentSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly parentName: string | null;
  readonly responsibleEmployeeId: string | null;
  readonly responsibleName: string | null;
  readonly active: boolean;
  readonly headcount: number;
}

export interface DepartmentNode extends DepartmentSummary {
  readonly children: readonly DepartmentNode[];
  readonly totalHeadcount: number;
}

async function employeeNameMap(db: DbLike, tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: hrEmployees.id,
      lastName: hrEmployees.lastName,
      firstName: hrEmployees.firstName,
    })
    .from(hrEmployees)
    .where(eq(hrEmployees.tenantId, tenantId));
  return new Map(rows.map((row) => [row.id, employeeFullName(row.lastName, row.firstName)]));
}

async function headcountByDepartment(db: DbLike, tenantId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ departmentId: hrEmployees.departmentId, total: count() })
    .from(hrEmployees)
    .where(
      and(
        eq(hrEmployees.tenantId, tenantId),
        isNotNull(hrEmployees.departmentId),
        ne(hrEmployees.status, "left"),
      ),
    )
    .groupBy(hrEmployees.departmentId);
  return new Map(rows.map((row) => [row.departmentId as string, Number(row.total)]));
}

async function loadDepartments(
  db: DbLike,
  tenantId: string,
): Promise<readonly DepartmentSummary[]> {
  const rows = await db
    .select({
      id: hrDepartments.id,
      code: hrDepartments.code,
      name: hrDepartments.name,
      parentId: hrDepartments.parentId,
      responsibleEmployeeId: hrDepartments.responsibleEmployeeId,
      active: hrDepartments.active,
    })
    .from(hrDepartments)
    .where(eq(hrDepartments.tenantId, tenantId))
    .orderBy(asc(hrDepartments.code));

  const [headcounts, employeeNames] = await Promise.all([
    headcountByDepartment(db, tenantId),
    employeeNameMap(db, tenantId),
  ]);
  const nameById = new Map(rows.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    parentName: row.parentId ? (nameById.get(row.parentId) ?? null) : null,
    responsibleEmployeeId: row.responsibleEmployeeId,
    responsibleName: row.responsibleEmployeeId
      ? (employeeNames.get(row.responsibleEmployeeId) ?? null)
      : null,
    active: row.active,
    headcount: headcounts.get(row.id) ?? 0,
  }));
}

/** HR-007 — l'arbre affiche l'effectif de chaque nœud cumulé avec ses descendants. */
export function buildDepartmentTree(
  departments: readonly DepartmentSummary[],
): readonly DepartmentNode[] {
  type MutableNode = DepartmentSummary & { children: MutableNode[]; totalHeadcount: number };
  const nodes: MutableNode[] = departments.map((department) => ({
    ...department,
    children: [],
    totalHeadcount: department.headcount,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: MutableNode[] = [];
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const accumulate = (node: MutableNode): number => {
    const children = node.children.map(accumulate);
    const total = node.headcount + children.reduce((sum, value) => sum + value, 0);
    node.totalHeadcount = total;
    node.children.sort((a, b) => a.code.localeCompare(b.code, "fr"));
    return total;
  };
  roots.forEach(accumulate);
  return roots.sort((a, b) => a.code.localeCompare(b.code, "fr"));
}

export async function listDepartments(
  db: Database,
  input: { tenantId: string; activeOnly?: boolean },
): Promise<readonly DepartmentSummary[]> {
  const all = await loadDepartments(db, input.tenantId);
  return input.activeOnly ? all.filter((department) => department.active) : all;
}

export async function getDepartmentTree(
  db: Database,
  input: { tenantId: string },
): Promise<readonly DepartmentNode[]> {
  return buildDepartmentTree(await loadDepartments(db, input.tenantId));
}

async function requireDepartment(db: DbLike, tenantId: string, id: string): Promise<string> {
  const [row] = await db
    .select({ code: hrDepartments.code })
    .from(hrDepartments)
    .where(and(eq(hrDepartments.tenantId, tenantId), eq(hrDepartments.id, id)))
    .limit(1);
  if (!row) {
    rethrow("Service introuvable dans cet espace.");
  }
  return row.code;
}

/** HR-009 — le calendrier rattaché à une fiche est celui du même espace. */
async function requireWorkCalendar(db: DbLike, tenantId: string, id: string): Promise<string> {
  const [row] = await db
    .select({ name: hrWorkCalendars.name })
    .from(hrWorkCalendars)
    .where(and(eq(hrWorkCalendars.tenantId, tenantId), eq(hrWorkCalendars.id, id)))
    .limit(1);
  if (!row) {
    rethrow("Calendrier de travail introuvable dans cet espace.");
  }
  return row.name;
}

/** HR-002 — la remontée de l'arbre refuse le parent lui-même ou l'un de ses descendants. */
async function assertParentAllowed(
  db: DbLike,
  tenantId: string,
  id: string,
  parentId: string,
): Promise<void> {
  let cursor: string | null = parentId;
  let depth = 0;
  while (cursor) {
    if (cursor === id) {
      rethrow("Service parent : un service ne peut pas descendre de lui-même.");
    }
    const [row] = await db
      .select({ parentId: hrDepartments.parentId })
      .from(hrDepartments)
      .where(and(eq(hrDepartments.tenantId, tenantId), eq(hrDepartments.id, cursor)))
      .limit(1);
    if (!row) {
      rethrow("Service parent introuvable dans cet espace.");
    }
    cursor = row.parentId;
    depth += 1;
    if (depth > MAX_DEPARTMENT_DEPTH) {
      rethrow(`Service parent : ${MAX_DEPARTMENT_DEPTH} niveaux maximum.`);
    }
  }
}

async function assertResponsibleEmployee(
  db: DbLike,
  tenantId: string,
  employeeId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: hrEmployees.id })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, employeeId)))
    .limit(1);
  if (!row) {
    rethrow("Responsable du service : ce salarié est introuvable dans cet espace.");
  }
}

export async function createDepartment(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: {
      code: unknown;
      name: unknown;
      parentId?: unknown;
      responsibleEmployeeId?: unknown;
      active?: unknown;
    };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateDepartmentInput(input.raw), "Service invalide.");
  try {
    return await db.transaction(async (tx) => {
      if (data.parentId) {
        await requireDepartment(tx, input.tenantId, data.parentId);
      }
      if (data.responsibleEmployeeId) {
        await assertResponsibleEmployee(tx, input.tenantId, data.responsibleEmployeeId);
      }
      const [created] = await tx
        .insert(hrDepartments)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          name: data.name,
          parentId: data.parentId,
          responsibleEmployeeId: data.responsibleEmployeeId,
          active: data.active,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrDepartments.id });
      if (!created) {
        rethrow("Le service n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.department.create",
        entityType: "hr_department",
        entityId: created.id,
        details: { code: data.code, name: data.name, active: data.active },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      rethrow(`Le code ${data.code} ou le nom de ce service est déjà pris dans cet espace.`);
    }
    throw error;
  }
}

export async function updateDepartment(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly departmentId: string;
    readonly raw: {
      code: unknown;
      name: unknown;
      parentId?: unknown;
      responsibleEmployeeId?: unknown;
      active?: unknown;
    };
  },
): Promise<void> {
  const data = assertValid(validateDepartmentInput(input.raw), "Service invalide.");
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: hrDepartments.id,
        code: hrDepartments.code,
        name: hrDepartments.name,
        parentId: hrDepartments.parentId,
        responsibleEmployeeId: hrDepartments.responsibleEmployeeId,
        active: hrDepartments.active,
      })
      .from(hrDepartments)
      .where(
        and(eq(hrDepartments.tenantId, input.tenantId), eq(hrDepartments.id, input.departmentId)),
      )
      .limit(1)
      .for("update");
    if (!before) {
      rethrow("Service introuvable dans cet espace.");
    }
    if (data.parentId) {
      await requireDepartment(tx, input.tenantId, data.parentId);
      await assertParentAllowed(tx, input.tenantId, before.id, data.parentId);
    }
    if (data.responsibleEmployeeId) {
      await assertResponsibleEmployee(tx, input.tenantId, data.responsibleEmployeeId);
    }
    await tx
      .update(hrDepartments)
      .set({
        code: data.code,
        name: data.name,
        parentId: data.parentId,
        responsibleEmployeeId: data.responsibleEmployeeId,
        active: data.active,
        updatedAt: new Date(),
      })
      .where(and(eq(hrDepartments.tenantId, input.tenantId), eq(hrDepartments.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.department.update",
      entityType: "hr_department",
      entityId: before.id,
      details: {
        before: {
          code: before.code,
          name: before.name,
          active: before.active,
          responsibleEmployeeId: before.responsibleEmployeeId,
        },
        after: {
          code: data.code,
          name: data.name,
          active: data.active,
          responsibleEmployeeId: data.responsibleEmployeeId,
        },
      },
    });
  });
}

/** HR-002 — un service ne se supprime pas : on le désactive, ses fiches gardent la référence. */
export async function setDepartmentActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly departmentId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [department] = await tx
      .select({ id: hrDepartments.id, code: hrDepartments.code, active: hrDepartments.active })
      .from(hrDepartments)
      .where(
        and(eq(hrDepartments.tenantId, input.tenantId), eq(hrDepartments.id, input.departmentId)),
      )
      .limit(1)
      .for("update");
    if (!department) {
      rethrow("Service introuvable dans cet espace.");
    }
    if (department.active === input.active) {
      return;
    }
    await tx
      .update(hrDepartments)
      .set({ active: input.active, updatedAt: new Date() })
      .where(and(eq(hrDepartments.tenantId, input.tenantId), eq(hrDepartments.id, department.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.department.update",
      entityType: "hr_department",
      entityId: department.id,
      details: { code: department.code, before: department.active, after: input.active },
    });
  });
}

/* --------------------------------------------------------------- fiches salarié */

export interface EmployeeSummary {
  readonly id: string;
  readonly code: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly fullName: string;
  readonly position: string | null;
  readonly hireDate: string;
  readonly status: HrEmployeeStatus;
  readonly statusLabel: string;
  readonly departureDate: string | null;
  readonly departmentId: string | null;
  readonly departmentCode: string | null;
  readonly managerEmployeeId: string | null;
  readonly managerName: string | null;
  readonly workCalendarId: string | null;
  readonly userId: string | null;
  readonly userEmail: string | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  readonly contracts: readonly ContractSummary[];
}

const EMPLOYEE_COLUMNS = {
  id: hrEmployees.id,
  code: hrEmployees.code,
  lastName: hrEmployees.lastName,
  firstName: hrEmployees.firstName,
  position: hrEmployees.position,
  hireDate: hrEmployees.hireDate,
  status: hrEmployees.status,
  departureDate: hrEmployees.departureDate,
  departmentId: hrEmployees.departmentId,
  departmentCode: hrDepartments.code,
  managerEmployeeId: hrEmployees.managerEmployeeId,
  workCalendarId: hrEmployees.workCalendarId,
  userId: hrEmployees.userId,
  userEmail: users.email,
};

function toEmployeeSummary(row: {
  readonly id: string;
  readonly code: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly position: string | null;
  readonly hireDate: string;
  readonly status: HrEmployeeStatus;
  readonly departureDate: string | null;
  readonly departmentId: string | null;
  readonly departmentCode: string | null;
  readonly managerEmployeeId: string | null;
  readonly workCalendarId: string | null;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly managerName?: string | null;
}): EmployeeSummary & { managerName: string | null } {
  return {
    id: row.id,
    code: row.code,
    lastName: row.lastName,
    firstName: row.firstName,
    fullName: employeeFullName(row.lastName, row.firstName),
    position: row.position,
    hireDate: row.hireDate,
    status: row.status,
    statusLabel: HR_EMPLOYEE_STATUS_LABELS[row.status],
    departureDate: row.departureDate,
    departmentId: row.departmentId,
    departmentCode: row.departmentCode,
    managerEmployeeId: row.managerEmployeeId,
    managerName: row.managerName ?? null,
    workCalendarId: row.workCalendarId,
    userId: row.userId,
    userEmail: row.userEmail,
  };
}

async function attachManagerNames(
  db: DbLike,
  tenantId: string,
  rows: readonly EmployeeSummary[],
): Promise<readonly EmployeeSummary[]> {
  const managerIds = [
    ...new Set(rows.map((row) => row.managerEmployeeId).filter((id): id is string => Boolean(id))),
  ];
  if (managerIds.length === 0) {
    return rows;
  }
  const names = await employeeNameMap(db, tenantId);
  return rows.map((row) => ({
    ...row,
    managerName: row.managerEmployeeId ? (names.get(row.managerEmployeeId) ?? null) : null,
  }));
}

export interface EmployeeFilters {
  readonly tenantId: string;
  readonly departmentId?: string | null;
  readonly status?: HrEmployeeStatus | null;
  readonly search?: string | null;
  readonly limit?: number;
}

function employeeFilters(input: EmployeeFilters) {
  const parts: (SQL<unknown> | undefined)[] = [eq(hrEmployees.tenantId, input.tenantId)];
  if (input.departmentId) {
    parts.push(eq(hrEmployees.departmentId, input.departmentId));
  }
  if (input.status) {
    parts.push(eq(hrEmployees.status, input.status));
  }
  const search = (input.search ?? "").trim().toLowerCase();
  if (search) {
    const needle = `%${search.replace(/[%_]/g, "")}%`;
    parts.push(
      or(
        sql`lower(${hrEmployees.code}) LIKE ${needle}`,
        sql`lower(${hrEmployees.lastName}) LIKE ${needle}`,
        sql`lower(${hrEmployees.firstName}) LIKE ${needle}`,
        sql`lower(concat(${hrEmployees.lastName}, ' ', ${hrEmployees.firstName})) LIKE ${needle}`,
      ),
    );
  }
  return and(...parts);
}

/** HR-007 — liste filtrable, sans aucun salaire (HR-005). */
export async function listEmployees(
  db: Database,
  input: EmployeeFilters,
): Promise<readonly EmployeeSummary[]> {
  const rows = await db
    .select(EMPLOYEE_COLUMNS)
    .from(hrEmployees)
    .leftJoin(hrDepartments, eq(hrEmployees.departmentId, hrDepartments.id))
    .leftJoin(users, eq(hrEmployees.userId, users.id))
    .where(employeeFilters(input))
    .orderBy(asc(hrEmployees.code))
    .limit(input.limit ?? HR_LIST_LIMIT);
  return attachManagerNames(
    db,
    input.tenantId,
    rows.map((row) => toEmployeeSummary(row)),
  );
}

export async function countEmployees(db: Database, input: EmployeeFilters): Promise<number> {
  const [row] = await db.select({ total: count() }).from(hrEmployees).where(employeeFilters(input));
  return Number(row?.total ?? 0);
}

async function requireEmployee(
  db: DbLike,
  tenantId: string,
  id: string,
): Promise<{ id: string; code: string; fullName: string; status: HrEmployeeStatus }> {
  const [row] = await db
    .select({
      id: hrEmployees.id,
      code: hrEmployees.code,
      status: hrEmployees.status,
      lastName: hrEmployees.lastName,
      firstName: hrEmployees.firstName,
    })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, id)))
    .limit(1);
  if (!row) {
    rethrow("Salarié introuvable dans cet espace.");
  }
  return {
    id: row.id,
    code: row.code,
    fullName: employeeFullName(row.lastName, row.firstName),
    status: row.status,
  };
}

function guardEmployeeReferences(error: unknown, code: string): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("hr_employees_tenant_department_fk")) {
    rethrow("Service introuvable dans cet espace.");
  }
  if (message.includes("hr_employees_tenant_manager_fk")) {
    rethrow("Manager introuvable dans cet espace.");
  }
  if (isUniqueViolation(error)) {
    if (message.includes("hr_employees_tenant_user_idx")) {
      rethrow("Ce compte est déjà rattaché à une autre fiche salarié de l'espace.");
    }
    rethrow(`Le matricule ${code} existe déjà dans cet espace.`);
  }
  throw error;
}

export async function createEmployee(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateEmployeeInput>[0] & { code: unknown };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateEmployeeInput(input.raw), "Fiche salarié invalide.");
  try {
    return await db.transaction(async (tx) => {
      if (data.departmentId) {
        await requireDepartment(tx, input.tenantId, data.departmentId);
      }
      if (data.managerEmployeeId) {
        const manager = await requireEmployee(tx, input.tenantId, data.managerEmployeeId);
        if (manager.status === "left") {
          rethrow(`Manager : ${manager.fullName} est sorti de l'effectif.`);
        }
      }
      if (data.workCalendarId) {
        await requireWorkCalendar(tx, input.tenantId, data.workCalendarId);
      }
      const [created] = await tx
        .insert(hrEmployees)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          lastName: data.lastName,
          firstName: data.firstName,
          position: data.position,
          hireDate: data.hireDate,
          status: data.status,
          departureDate: data.departureDate,
          departmentId: data.departmentId,
          managerEmployeeId: data.managerEmployeeId,
          workCalendarId: data.workCalendarId,
          createdByUserId: input.actorUserId,
        })
        .returning({ id: hrEmployees.id });
      if (!created) {
        rethrow("La fiche salarié n'a pas pu être créée.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "hr.employee.create",
        entityType: "hr_employee",
        entityId: created.id,
        details: {
          code: data.code,
          fullName: employeeFullName(data.lastName, data.firstName),
          hireDate: data.hireDate,
          status: data.status,
        },
      });
      return created;
    });
  } catch (error) {
    guardEmployeeReferences(error, data.code);
  }
}

/** HR-003 — une fiche passée par « sorti » ne peut rester responsable ou manager. */
async function assertLeavingAllowed(tx: Transaction, tenantId: string, id: string): Promise<void> {
  const [departments] = await tx
    .select({ codes: sql<string>`coalesce(string_agg(${hrDepartments.code}, ', '), '')` })
    .from(hrDepartments)
    .where(and(eq(hrDepartments.tenantId, tenantId), eq(hrDepartments.responsibleEmployeeId, id)));
  if (departments?.codes) {
    rethrow(
      `Sortie refusée : ce salarié est responsable du service ${departments.codes}. Désigne un autre responsable.`,
    );
  }
  const [team] = await tx
    .select({ total: count() })
    .from(hrEmployees)
    .where(
      and(
        eq(hrEmployees.tenantId, tenantId),
        eq(hrEmployees.managerEmployeeId, id),
        ne(hrEmployees.status, "left"),
      ),
    );
  if (Number(team?.total ?? 0) > 0) {
    rethrow(
      `Sortie refusée : ${Number(team?.total ?? 0)} salarié(s) lui sont rattachés comme manager. Rattache-les d'abord.`,
    );
  }
}

export async function updateEmployee(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly employeeId: string;
    readonly raw: Parameters<typeof validateEmployeeInput>[0];
  },
): Promise<void> {
  const data = assertValid(
    validateEmployeeInput({ ...input.raw, employeeId: input.employeeId }),
    "Fiche salarié invalide.",
  );
  await db.transaction(async (tx) => {
    const before = await loadEmployeeForUpdate(tx, input.tenantId, input.employeeId);
    if (data.managerEmployeeId) {
      const manager = await requireEmployee(tx, input.tenantId, data.managerEmployeeId);
      if (manager.id === before.id) {
        rethrow("Manager : un salarié ne peut pas être son propre manager.");
      }
      if (manager.status === "left") {
        rethrow(`Manager : ${manager.fullName} est sorti de l'effectif.`);
      }
    }
    if (data.departmentId) {
      await requireDepartment(tx, input.tenantId, data.departmentId);
    }
    if (data.workCalendarId) {
      await requireWorkCalendar(tx, input.tenantId, data.workCalendarId);
    }
    if (before.status !== "left" && data.status === "left") {
      await assertLeavingAllowed(tx, input.tenantId, before.id);
    }
    await tx
      .update(hrEmployees)
      .set({
        code: data.code,
        lastName: data.lastName,
        firstName: data.firstName,
        position: data.position,
        hireDate: data.hireDate,
        status: data.status,
        departureDate: data.departureDate,
        departmentId: data.departmentId,
        managerEmployeeId: data.managerEmployeeId,
        workCalendarId: data.workCalendarId,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.employee.update",
      entityType: "hr_employee",
      entityId: before.id,
      details: {
        code: data.code,
        before: {
          code: before.code,
          fullName: before.fullName,
          status: before.status,
          departmentId: before.departmentId,
        },
        after: {
          code: data.code,
          fullName: employeeFullName(data.lastName, data.firstName),
          status: data.status,
          departmentId: data.departmentId,
        },
      },
    });
  });
}

async function loadEmployeeForUpdate(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<{
  id: string;
  code: string;
  fullName: string;
  status: HrEmployeeStatus;
  departmentId: string | null;
  userId: string | null;
}> {
  const [row] = await tx
    .select({
      id: hrEmployees.id,
      code: hrEmployees.code,
      lastName: hrEmployees.lastName,
      firstName: hrEmployees.firstName,
      status: hrEmployees.status,
      departmentId: hrEmployees.departmentId,
      userId: hrEmployees.userId,
    })
    .from(hrEmployees)
    .where(and(eq(hrEmployees.tenantId, tenantId), eq(hrEmployees.id, id)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Salarié introuvable dans cet espace.");
  }
  return {
    id: row.id,
    code: row.code,
    fullName: employeeFullName(row.lastName, row.firstName),
    status: row.status,
    departmentId: row.departmentId,
    userId: row.userId,
  };
}

export async function getEmployee(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly employeeId: string;
    readonly showSalary: boolean;
    readonly today?: string;
  },
): Promise<EmployeeDetail | null> {
  const [row] = await db
    .select(EMPLOYEE_COLUMNS)
    .from(hrEmployees)
    .leftJoin(hrDepartments, eq(hrEmployees.departmentId, hrDepartments.id))
    .leftJoin(users, eq(hrEmployees.userId, users.id))
    .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.id, input.employeeId)))
    .limit(1);
  if (!row) {
    return null;
  }
  const [summary] = await attachManagerNames(db, input.tenantId, [toEmployeeSummary(row)]);
  if (!summary) {
    rethrow("Salarié introuvable dans cet espace.");
  }
  const contracts = await listContracts(db, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    showSalary: input.showSalary,
    today: input.today,
  });
  return { ...summary, contracts };
}

/** HR-003 — le rattachement à un compte membre ne change aucun droit. */
export async function linkEmployeeUser(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly employeeId: string;
    readonly userId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const employee = await loadEmployeeForUpdate(tx, input.tenantId, input.employeeId);
    const [member] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)))
      .limit(1);
    if (!member) {
      rethrow("Rattachement refusé : ce compte n'est pas membre de cet espace.");
    }
    const [taken] = await tx
      .select({ id: hrEmployees.id, code: hrEmployees.code })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.userId, input.userId)))
      .limit(1);
    if (taken && taken.id !== employee.id) {
      rethrow(`Ce compte est déjà rattaché à la fiche ${taken.code}.`);
    }
    if (taken && taken.id === employee.id) {
      return;
    }
    const [account] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    await tx
      .update(hrEmployees)
      .set({ userId: input.userId, updatedByUserId: input.actorUserId, updatedAt: new Date() })
      .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.id, employee.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.employee.link",
      entityType: "hr_employee",
      entityId: employee.id,
      details: {
        code: employee.code,
        before: null,
        after: account?.email ?? input.userId,
      },
    });
  });
}

export async function unlinkEmployeeUser(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly employeeId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const employee = await loadEmployeeForUpdate(tx, input.tenantId, input.employeeId);
    if (!employee.userId) {
      return;
    }
    const [account] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, employee.userId))
      .limit(1);
    await tx
      .update(hrEmployees)
      .set({ userId: null, updatedByUserId: input.actorUserId, updatedAt: new Date() })
      .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.id, employee.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.employee.unlink",
      entityType: "hr_employee",
      entityId: employee.id,
      details: { code: employee.code, before: account?.email ?? employee.userId, after: null },
    });
  });
}

/** HR-003 — une fiche qui a des contrats n'est jamais supprimée : elle passe par « sorti ». */
export async function deleteEmployee(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly employeeId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const employee = await loadEmployeeForUpdate(tx, input.tenantId, input.employeeId);
    const [contracts] = await tx
      .select({ total: count() })
      .from(hrContracts)
      .where(
        and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.employeeId, employee.id)),
      );
    if (Number(contracts?.total ?? 0) > 0) {
      rethrow(
        `Suppression refusée : cette fiche porte ${Number(contracts?.total ?? 0)} contrat(s). Passe-la par « sorti ».`,
      );
    }
    if (employee.userId) {
      rethrow("Suppression refusée : détache d'abord le compte rattaché à cette fiche.");
    }
    const [asManager] = await tx
      .select({ total: count() })
      .from(hrEmployees)
      .where(
        and(
          eq(hrEmployees.tenantId, input.tenantId),
          eq(hrEmployees.managerEmployeeId, employee.id),
        ),
      );
    if (Number(asManager?.total ?? 0) > 0) {
      rethrow("Suppression refusée : d'autres salariés ont ce manager.");
    }
    const [asResponsible] = await tx
      .select({ total: count() })
      .from(hrDepartments)
      .where(
        and(
          eq(hrDepartments.tenantId, input.tenantId),
          eq(hrDepartments.responsibleEmployeeId, employee.id),
        ),
      );
    if (Number(asResponsible?.total ?? 0) > 0) {
      rethrow("Suppression refusée : ce salarié est responsable d'un service.");
    }
    await tx
      .delete(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, input.tenantId), eq(hrEmployees.id, employee.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.employee.delete",
      entityType: "hr_employee",
      entityId: employee.id,
      details: { code: employee.code, fullName: employee.fullName },
    });
  });
}

/* -------------------------------------------------------------------- contrats */

export interface ContractSummary {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly kind: HrContractKind;
  readonly kindLabel: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly trialPeriodDays: number;
  readonly trialDeadline: string | null;
  readonly weeklyHours: string;
  readonly status: HrContractStatus;
  readonly displayStatus: HrContractDisplayStatus;
  readonly displayLabel: string;
  readonly terminatedOn: string | null;
  readonly salaryXof: number | null;
}

interface ContractRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: HrContractKind;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly trialPeriodDays: number;
  readonly weeklyHours: string;
  readonly status: HrContractStatus;
  readonly terminatedOn: string | null;
  readonly salaryXof: number;
}

type ContractReadRow = ContractRecord & {
  readonly employeeCode: string;
  readonly employeeLastName: string;
  readonly employeeFirstName: string;
};

const CONTRACT_OWN_COLUMNS = {
  id: hrContracts.id,
  employeeId: hrContracts.employeeId,
  kind: hrContracts.kind,
  startDate: hrContracts.startDate,
  endDate: hrContracts.endDate,
  trialPeriodDays: hrContracts.trialPeriodDays,
  weeklyHours: hrContracts.weeklyHours,
  status: hrContracts.status,
  terminatedOn: hrContracts.terminatedOn,
  salaryXof: hrContracts.salaryXof,
};

const CONTRACT_READ_COLUMNS = {
  ...CONTRACT_OWN_COLUMNS,
  employeeCode: hrEmployees.code,
  employeeLastName: hrEmployees.lastName,
  employeeFirstName: hrEmployees.firstName,
};

function toContractSummary(
  row: ContractReadRow,
  input: { readonly showSalary: boolean; readonly today: string },
): ContractSummary {
  const display = contractDisplayStatus({
    status: row.status,
    endDate: row.endDate,
    today: input.today,
  });
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: employeeFullName(row.employeeLastName, row.employeeFirstName),
    kind: row.kind,
    kindLabel: HR_CONTRACT_KIND_LABELS[row.kind],
    startDate: row.startDate,
    endDate: row.endDate,
    trialPeriodDays: row.trialPeriodDays,
    trialDeadline: row.trialPeriodDays > 0 ? addIsoDays(row.startDate, row.trialPeriodDays) : null,
    weeklyHours: row.weeklyHours,
    status: row.status,
    displayStatus: display,
    displayLabel: HR_CONTRACT_DISPLAY_LABELS[display],
    terminatedOn: row.terminatedOn,
    salaryXof: input.showSalary ? row.salaryXof : null,
  };
}

/** HR-005 — la liste ne renvoie le salaire que si le niveau du module le permet. */
export async function listContracts(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly employeeId?: string | null;
    readonly status?: HrContractDisplayStatus | null;
    readonly showSalary: boolean;
    readonly today?: string;
    readonly limit?: number;
  },
): Promise<readonly ContractSummary[]> {
  const today = input.today ?? todayIsoDate();
  const parts: (SQL<unknown> | undefined)[] = [eq(hrContracts.tenantId, input.tenantId)];
  if (input.employeeId) {
    parts.push(eq(hrContracts.employeeId, input.employeeId));
  }
  const rows = await db
    .select(CONTRACT_READ_COLUMNS)
    .from(hrContracts)
    .innerJoin(hrEmployees, eq(hrContracts.employeeId, hrEmployees.id))
    .where(and(...parts))
    .orderBy(desc(hrContracts.startDate), asc(hrEmployees.code))
    .limit(input.limit ?? HR_LIST_LIMIT);

  const summaries = rows.map((row) =>
    toContractSummary(row as ContractReadRow, { showSalary: input.showSalary, today }),
  );
  if (!input.status) {
    return summaries;
  }
  return summaries.filter((contract) => contract.displayStatus === input.status);
}

export async function getContract(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly contractId: string;
    readonly showSalary: boolean;
    readonly today?: string;
  },
): Promise<ContractSummary | null> {
  const [row] = await db
    .select(CONTRACT_READ_COLUMNS)
    .from(hrContracts)
    .innerJoin(hrEmployees, eq(hrContracts.employeeId, hrEmployees.id))
    .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.id, input.contractId)))
    .limit(1);
  if (!row) {
    return null;
  }
  return toContractSummary(row as ContractReadRow, {
    showSalary: input.showSalary,
    today: input.today ?? todayIsoDate(),
  });
}

async function lockContract(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<ContractRecord> {
  const [row] = await tx
    .select(CONTRACT_OWN_COLUMNS)
    .from(hrContracts)
    .where(and(eq(hrContracts.tenantId, tenantId), eq(hrContracts.id, id)))
    .limit(1)
    .for("update");
  if (!row) {
    rethrow("Contrat introuvable dans cet espace.");
  }
  return row as ContractRecord;
}

export async function createContract(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: Parameters<typeof validateContractInput>[0];
  },
): Promise<{ id: string }> {
  const data = assertValid(validateContractInput(input.raw), "Contrat invalide.");
  return db.transaction(async (tx) => {
    const employee = await requireEmployee(tx, input.tenantId, data.employeeId);
    const [created] = await tx
      .insert(hrContracts)
      .values({
        tenantId: input.tenantId,
        employeeId: employee.id,
        kind: data.kind,
        startDate: data.startDate,
        endDate: data.endDate,
        trialPeriodDays: data.trialPeriodDays,
        weeklyHours: data.weeklyHours,
        salaryXof: data.salaryXof,
        status: "draft",
        createdByUserId: input.actorUserId,
      })
      .returning({ id: hrContracts.id });
    if (!created) {
      rethrow("Le contrat n'a pas pu être créé.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.contract.create",
      entityType: "hr_contract",
      entityId: created.id,
      details: {
        employeeCode: employee.code,
        kind: data.kind,
        startDate: data.startDate,
        endDate: data.endDate,
        trialPeriodDays: data.trialPeriodDays,
        weeklyHours: data.weeklyHours,
        status: "draft",
      },
    });
    return created;
  });
}

/** HR-004 — les dates, le type, la durée et le salaire d'un contrat sorti du brouillon sont figés. */
export async function updateContract(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly contractId: string;
    readonly raw: Parameters<typeof validateContractInput>[0];
  },
): Promise<void> {
  const data = assertValid(validateContractInput(input.raw), "Contrat invalide.");
  await db.transaction(async (tx) => {
    const before = await lockContract(tx, input.tenantId, input.contractId);
    if (before.status !== "draft") {
      rethrow(
        "Contrat figé : il a quitté le brouillon. Résilie-le et crée un nouveau contrat pour corriger.",
      );
    }
    const employee = await requireEmployee(tx, input.tenantId, data.employeeId);
    await tx
      .update(hrContracts)
      .set({
        employeeId: employee.id,
        kind: data.kind,
        startDate: data.startDate,
        endDate: data.endDate,
        trialPeriodDays: data.trialPeriodDays,
        weeklyHours: data.weeklyHours,
        salaryXof: data.salaryXof,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.id, before.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.contract.update",
      entityType: "hr_contract",
      entityId: before.id,
      details: {
        employeeCode: employee.code,
        before: { kind: before.kind, startDate: before.startDate, endDate: before.endDate },
        after: { kind: data.kind, startDate: data.startDate, endDate: data.endDate },
        weeklyHours: data.weeklyHours,
        trialPeriodDays: data.trialPeriodDays,
      },
    });
  });
}

export async function startContract(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly contractId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const contract = await lockContract(tx, input.tenantId, input.contractId);
    if (contract.status === "running") {
      return;
    }
    if (contract.status !== "draft") {
      rethrow("Seul un brouillon de contrat peut passer en cours.");
    }
    const [running] = await tx
      .select({ id: hrContracts.id })
      .from(hrContracts)
      .where(
        and(
          eq(hrContracts.tenantId, input.tenantId),
          eq(hrContracts.employeeId, contract.employeeId),
          eq(hrContracts.status, "running"),
        ),
      )
      .limit(1);
    if (running) {
      rethrow("Ce salarié a déjà un contrat en cours : clôture-le avant d'en ouvrir un autre.");
    }
    const employee = await requireEmployee(tx, input.tenantId, contract.employeeId);
    await tx
      .update(hrContracts)
      .set({ status: "running", updatedByUserId: input.actorUserId, updatedAt: new Date() })
      .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.id, contract.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.contract.status",
      entityType: "hr_contract",
      entityId: contract.id,
      details: {
        employeeCode: employee.code,
        kind: contract.kind,
        before: "draft",
        after: "running",
      },
    });
  });
}

export async function terminateContract(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly contractId: string;
    readonly terminatedOn: unknown;
  },
): Promise<void> {
  const parsed = parseIsoDate(input.terminatedOn, "Date de résiliation", true);
  if (parsed.errors.length > 0 || !parsed.value) {
    throw new HrError(parsed.errors[0] ?? "Date de résiliation invalide.");
  }
  const terminatedOn = parsed.value;
  await db.transaction(async (tx) => {
    const contract = await lockContract(tx, input.tenantId, input.contractId);
    if (contract.status === "terminated") {
      return;
    }
    if (contract.status !== "running") {
      rethrow("Seul un contrat en cours peut être résilié.");
    }
    if (terminatedOn < contract.startDate) {
      rethrow("Date de résiliation : doit être postérieure ou égale au début du contrat.");
    }
    const employee = await requireEmployee(tx, input.tenantId, contract.employeeId);
    await tx
      .update(hrContracts)
      .set({
        status: "terminated",
        terminatedOn,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.id, contract.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.contract.status",
      entityType: "hr_contract",
      entityId: contract.id,
      details: {
        employeeCode: employee.code,
        kind: contract.kind,
        before: "running",
        after: "terminated",
        terminatedOn,
      },
    });
  });
}

/** HR-004 — un brouillon seul se supprime. */
export async function deleteContract(
  db: Database,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly contractId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const contract = await lockContract(tx, input.tenantId, input.contractId);
    if (contract.status !== "draft") {
      rethrow("Seul un brouillon de contrat se supprime : les autres sont résiliés et conservés.");
    }
    const employee = await requireEmployee(tx, input.tenantId, contract.employeeId);
    await tx
      .delete(hrContracts)
      .where(and(eq(hrContracts.tenantId, input.tenantId), eq(hrContracts.id, contract.id)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "hr.contract.delete",
      entityType: "hr_contract",
      entityId: contract.id,
      details: {
        employeeCode: employee.code,
        kind: contract.kind,
        startDate: contract.startDate,
      },
    });
  });
}

/* ---------------------------------------------------------------------- hub RH */

export interface HrOverview {
  readonly departments: number;
  readonly activeEmployees: number;
  readonly suspendedEmployees: number;
  readonly leftEmployees: number;
  readonly runningContracts: number;
  readonly trialContracts: number;
  readonly hiresThisMonth: number;
  readonly departuresThisMonth: number;
}

/** HR-007 — tous les compteurs sont recalculés à la lecture, aucune écriture de snapshot. */
export async function getHrOverview(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly today?: string;
    readonly employeeId?: string | null;
  },
): Promise<HrOverview> {
  const today = input.today ?? todayIsoDate();
  const month = today.slice(0, 7);
  const [departmentCount] = await db
    .select({ total: count() })
    .from(hrDepartments)
    .where(eq(hrDepartments.tenantId, input.tenantId));
  const byStatus = await db
    .select({ status: hrEmployees.status, total: count() })
    .from(hrEmployees)
    .where(eq(hrEmployees.tenantId, input.tenantId))
    .groupBy(hrEmployees.status);
  const monthStart = `${month}-01`;
  const [year, ordinal] = month.split("-").map(Number) as [number, number];
  const nextMonthStart =
    ordinal === 12 ? `${year + 1}-01-01` : `${year}-${String(ordinal + 1).padStart(2, "0")}-01`;
  const [hires] = await db
    .select({ total: count() })
    .from(hrEmployees)
    .where(
      and(
        eq(hrEmployees.tenantId, input.tenantId),
        gte(hrEmployees.hireDate, monthStart),
        lt(hrEmployees.hireDate, nextMonthStart),
      ),
    );
  const [departures] = await db
    .select({ total: count() })
    .from(hrEmployees)
    .where(
      and(
        eq(hrEmployees.tenantId, input.tenantId),
        gte(hrEmployees.departureDate, monthStart),
        lt(hrEmployees.departureDate, nextMonthStart),
      ),
    );
  const running = await db
    .select({
      startDate: hrContracts.startDate,
      endDate: hrContracts.endDate,
      trialPeriodDays: hrContracts.trialPeriodDays,
    })
    .from(hrContracts)
    .where(
      and(
        eq(hrContracts.tenantId, input.tenantId),
        eq(hrContracts.status, "running"),
        input.employeeId ? eq(hrContracts.employeeId, input.employeeId) : undefined,
      ),
    );
  const stillRunning = running.filter((contract) => !contract.endDate || contract.endDate >= today);
  const onTrial = stillRunning.filter(
    (contract) =>
      contract.trialPeriodDays > 0 &&
      addIsoDays(contract.startDate, contract.trialPeriodDays) >= today,
  );

  const statusCount = (status: HrEmployeeStatus): number =>
    Number(byStatus.find((row) => row.status === status)?.total ?? 0);

  return {
    departments: Number(departmentCount?.total ?? 0),
    activeEmployees: statusCount("active"),
    suspendedEmployees: statusCount("suspended"),
    leftEmployees: statusCount("left"),
    runningContracts: stillRunning.length,
    trialContracts: onTrial.length,
    hiresThisMonth: Number(hires?.total ?? 0),
    departuresThisMonth: Number(departures?.total ?? 0),
  };
}
