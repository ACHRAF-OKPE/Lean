import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  hrDepartments,
  hrEmployees,
  importRows,
  memberships,
  users,
} from "@/db/schema";
import type { ValidationContext } from "@/modules/catalog/validation";
import { departmentKey } from "./import-validation";
import type { HrEmployeeImportData } from "./import-validation";
import { HrError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

export interface ApplyHrEmployeeImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

export async function loadHrImportContext(
  db: Database,
  tenantId: string,
): Promise<Partial<ValidationContext>> {
  const [departments, employees, memberRows, linked] = await Promise.all([
    db
      .select({
        id: hrDepartments.id,
        code: hrDepartments.code,
        active: hrDepartments.active,
      })
      .from(hrDepartments)
      .where(eq(hrDepartments.tenantId, tenantId)),
    db
      .select({
        id: hrEmployees.id,
        code: hrEmployees.code,
        status: hrEmployees.status,
        departureDate: hrEmployees.departureDate,
      })
      .from(hrEmployees)
      .where(eq(hrEmployees.tenantId, tenantId)),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId)),
    db
      .select({ id: hrEmployees.id, userId: hrEmployees.userId })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, tenantId), isNotNull(hrEmployees.userId))),
  ]);

  return {
    hrDepartmentsByCode: new Map(departments.map((row) => [departmentKey(row.code), row])),
    hrEmployeesByCode: new Map(employees.map((row) => [row.code, row])),
    hrMembersByEmail: new Map(
      memberRows.map((row) => [row.email.toLowerCase(), { id: row.id, name: row.name }]),
    ),
    hrLinkedUserIds: new Map(linked.map((row) => [row.id, row.userId as string])),
  };
}

export async function applyHrEmployeeImport(
  tx: Transaction,
  input: ApplyHrEmployeeImportInput,
): Promise<{ written: number }> {
  if (input.rows.length === 0) {
    throw new HrError("Aucun salarié applicable dans cet import.");
  }

  const departmentIds = [
    ...new Set(
      input.rows
        .map((row) => (row.data as unknown as HrEmployeeImportData).departmentId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const managerIds = [
    ...new Set(
      input.rows
        .map((row) => (row.data as unknown as HrEmployeeImportData).managerEmployeeId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const departmentRows =
    departmentIds.length === 0
      ? []
      : await tx
          .select({ id: hrDepartments.id, active: hrDepartments.active })
          .from(hrDepartments)
          .where(
            and(
              eq(hrDepartments.tenantId, input.tenantId),
              inArray(hrDepartments.id, departmentIds),
            ),
          );
  const managerRows =
    managerIds.length === 0
      ? []
      : await tx
          .select({ id: hrEmployees.id, code: hrEmployees.code, status: hrEmployees.status })
          .from(hrEmployees)
          .where(
            and(eq(hrEmployees.tenantId, input.tenantId), inArray(hrEmployees.id, managerIds)),
          );

  const departmentsById = new Map(departmentRows.map((row) => [row.id, row]));
  const managersById = new Map(managerRows.map((row) => [row.id, row]));

  const values = input.rows.map((row) => {
    const data = row.data as unknown as HrEmployeeImportData;
    if (data.departmentId) {
      const department = departmentsById.get(data.departmentId);
      if (!department || !department.active) {
        throw new HrError(
          `Ligne ${row.rowNumber} : service indisponible. Relancez l'analyse avant de confirmer.`,
        );
      }
    }
    if (data.managerEmployeeId) {
      const manager = managersById.get(data.managerEmployeeId);
      if (!manager || manager.status === "left" || manager.code === data.code) {
        throw new HrError(
          `Ligne ${row.rowNumber} : manager indisponible. Relancez l'analyse avant de confirmer.`,
        );
      }
    }
    if (data.status === "left" && !data.departureDate) {
      throw new HrError(
        `Ligne ${row.rowNumber} : date de sortie manquante. Relancez l'analyse avant de confirmer.`,
      );
    }
    return {
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
      userId: data.userId,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
    };
  });

  await tx
    .insert(hrEmployees)
    .values(values)
    .onConflictDoUpdate({
      target: [hrEmployees.tenantId, hrEmployees.code],
      set: {
        lastName: sql`excluded.last_name`,
        firstName: sql`excluded.first_name`,
        position: sql`coalesce(excluded.position, hr_employees.position)`,
        hireDate: sql`excluded.hire_date`,
        status: sql`excluded.status`,
        departureDate: sql`coalesce(excluded.departure_date, hr_employees.departure_date)`,
        departmentId: sql`coalesce(excluded.department_id, hr_employees.department_id)`,
        managerEmployeeId: sql`coalesce(excluded.manager_employee_id, hr_employees.manager_employee_id)`,
        userId: sql`coalesce(excluded.user_id, hr_employees.user_id)`,
        updatedByUserId: input.actorUserId,
        updatedAt: sql`now()`,
      },
    });

  await tx.execute(sql`
    update ${importRows} as r
    set entity_id = c.id
    from ${hrEmployees} as c
    where r.tenant_id = ${input.tenantId}
      and r.batch_id = ${input.batchId}
      and r.status <> 'error'
      and c.tenant_id = r.tenant_id
      and c.code = r.code
  `);

  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "hr.employee.import",
    entityType: "import_batch",
    entityId: input.batchId,
    details: {
      source: "import",
      written: values.length,
      codes: values.map((value) => value.code),
    },
  });

  return { written: values.length };
}
