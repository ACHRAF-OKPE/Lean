import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, hrContracts, hrEmployees, moduleGrants, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import { resolveLevels } from "@/modules/identity/modules";
import { HrError } from "./errors";
import {
  createContract,
  createDepartment,
  createEmployee,
  deleteContract,
  deleteEmployee,
  getContract,
  getDepartmentTree,
  getEmployee,
  getHrOverview,
  linkEmployeeUser,
  listContracts,
  listDepartments,
  listEmployees,
  setDepartmentActive,
  startContract,
  terminateContract,
  unlinkEmployeeUser,
  updateContract,
  updateDepartment,
  updateEmployee,
} from "./queries";

const TODAY = "2026-11-01";

let context: TestDatabase;
let db: Database;
let ids: HrTenant;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  ids = await seedHrTenant(db, "socle");
});

afterAll(async () => {
  await context.close();
});

async function makeDepartment(
  options: Partial<{
    code: string;
    name: string;
    parentId: string;
    responsibleEmployeeId: string;
  }> = {},
) {
  const sequence = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase();
  const code = options.code ?? `SVC${sequence}`.slice(0, 8);
  const created = await createDepartment(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: {
      code,
      name: options.name ?? `Service ${sequence}`,
      parentId: options.parentId ?? "",
      responsibleEmployeeId: options.responsibleEmployeeId ?? "",
    },
  });
  return { id: created.id, code };
}

async function makeEmployee(
  options: Partial<{
    code: string;
    lastName: string;
    firstName: string;
    position: string;
    hireDate: string;
    status: string;
    departureDate: string;
    departmentId: string;
    managerEmployeeId: string;
    tenantId: string;
    actorUserId: string;
  }> = {},
) {
  const sequence = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase();
  const code = options.code ?? `EMP${sequence}`.slice(0, 10);
  const created = await createEmployee(db, {
    tenantId: options.tenantId ?? ids.tenantId,
    actorUserId: options.actorUserId ?? ids.userId,
    raw: {
      code,
      lastName: options.lastName ?? `Nom${sequence}`.slice(0, 12),
      firstName: options.firstName ?? "Awa",
      position: options.position ?? "",
      hireDate: options.hireDate ?? "2026-01-15",
      status: options.status ?? "active",
      departureDate: options.departureDate ?? "",
      departmentId: options.departmentId ?? "",
      managerEmployeeId: options.managerEmployeeId ?? "",
    },
  });
  return { id: created.id, code };
}

async function makeContract(
  employeeId: string,
  options: Partial<{
    kind: string;
    startDate: string;
    endDate: string;
    trialPeriodDays: string;
    weeklyHours: string;
    salaryXof: string;
  }> = {},
) {
  return createContract(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: {
      employeeId,
      kind: options.kind ?? "cdi",
      startDate: options.startDate ?? "2026-01-15",
      endDate: options.endDate ?? "",
      trialPeriodDays: options.trialPeriodDays ?? "30",
      weeklyHours: options.weeklyHours ?? "40",
      salaryXof: options.salaryXof ?? "250000",
    },
  });
}

function auditWhere(entityType: string, entityId: string) {
  return and(
    eq(auditEvents.tenantId, ids.tenantId),
    eq(auditEvents.entityType, entityType),
    eq(auditEvents.entityId, entityId),
  );
}

async function latestAudit(entityType: string, entityId: string) {
  const [row] = await db
    .select({ action: auditEvents.action, details: auditEvents.details })
    .from(auditEvents)
    .where(auditWhere(entityType, entityId))
    .orderBy(sql`${auditEvents.createdAt} desc`)
    .limit(1);
  if (!row) {
    throw new Error(`Aucun évènement d'audit pour ${entityType} ${entityId}.`);
  }
  return row;
}

describe("HR-002 — organisation des services", () => {
  it("normalise le code en majuscules et refuse un code ou un nom déjà pris", async () => {
    const created = await createDepartment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "adm", name: "Administration", parentId: "", responsibleEmployeeId: "" },
    });
    const [row] = await db.select({ code: hrContracts.id }).from(hrContracts).limit(0);
    expect(row).toBeUndefined();
    expect(created.id).toBeTruthy();

    const departments = await listDepartments(db, { tenantId: ids.tenantId });
    expect(departments.find((department) => department.id === created.id)?.code).toBe("ADM");

    await expect(makeDepartment({ code: "ADM", name: "Autre nom" })).rejects.toThrow(HrError);
    await expect(
      createDepartment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "FIN", name: "Administration", parentId: "", responsibleEmployeeId: "" },
      }),
    ).rejects.toThrow(/déjà pris/);
  });

  it("refuse un service parent qui est lui-même ou l'un de ses descendants", async () => {
    const parent = await makeDepartment({ name: "Direction générale test" });
    const child = await makeDepartment({ name: "Agence nord test" });
    await updateDepartment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      departmentId: child.id,
      raw: {
        code: child.id
          .slice(0, 6)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "X"),
        name: "Agence nord test",
        parentId: parent.id,
      },
    });

    await expect(
      updateDepartment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        departmentId: parent.id,
        raw: { code: "DGTEST1", name: "Direction générale test", parentId: parent.id },
      }),
    ).rejects.toThrow(/lui-même/);

    await expect(
      updateDepartment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        departmentId: parent.id,
        raw: { code: "DGTEST2", name: "Direction générale test", parentId: child.id },
      }),
    ).rejects.toThrow(/descend|lui-même/);
  });

  it("refuse un parent ou un responsable venu d'un autre espace", async () => {
    const outsider = await makeEmployee({
      tenantId: ids.otherTenantId,
      actorUserId: ids.otherTenantUserId,
    });
    await expect(
      createDepartment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "HORS", name: "Service hors espace", parentId: outsider.id },
      }),
    ).rejects.toThrow(/Service introuvable/);

    await expect(
      createDepartment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: {
          code: "RESP",
          name: "Service responsable hors espace",
          responsibleEmployeeId: outsider.id,
        },
      }),
    ).rejects.toThrow(/salarié est introuvable/);
  });

  it("désactive un service sans le supprimer et trace la modification", async () => {
    const department = await makeDepartment({ name: "Service à désactiver" });
    const employee = await makeEmployee({ departmentId: department.id });

    await setDepartmentActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      departmentId: department.id,
      active: false,
    });

    const activeOnly = await listDepartments(db, { tenantId: ids.tenantId, activeOnly: true });
    expect(activeOnly.some((row) => row.id === department.id)).toBe(false);

    const fiches = await listEmployees(db, { tenantId: ids.tenantId });
    expect(fiches.find((row) => row.id === employee.id)?.departmentCode).toBe(department.code);

    const audit = await latestAudit("hr_department", department.id);
    expect(audit.action).toBe("hr.department.update");
    expect(audit.details).toMatchObject({ before: true, after: false });

    const tree = await getDepartmentTree(db, { tenantId: ids.tenantId });
    const flat = JSON.stringify(tree);
    expect(flat).toContain(department.code);
  });

  it("isole les services d'un espace voisin", async () => {
    const here = await makeDepartment({ name: "Service visible ici" });
    await makeDepartment({ code: "DGTEST1", name: "Direction générale voisine" });
    const treeElsewhere = await getDepartmentTree(db, { tenantId: ids.otherTenantId });
    expect(treeElsewhere.some((node) => node.id === here.id)).toBe(false);

    await expect(
      updateDepartment(db, {
        tenantId: ids.otherTenantId,
        actorUserId: ids.otherTenantUserId,
        departmentId: here.id,
        raw: { code: "VOLE", name: "Volé" },
      }),
    ).rejects.toThrow(/introuvable/);
  });
});

describe("HR-003 — fiche salarié", () => {
  it("refuse un matricule en doublon dans l'espace", async () => {
    const first = await makeEmployee({ code: "MATDUP" });
    expect(first.id).toBeTruthy();
    await expect(makeEmployee({ code: "matdup" })).rejects.toThrow(/MATDUP existe déjà/);
  });

  it("exige une date de sortie postérieure à l'embauche", async () => {
    await expect(makeEmployee({ status: "left", hireDate: "2026-01-15" })).rejects.toThrow(
      /Date de sortie : obligatoire/,
    );
    await expect(
      makeEmployee({ status: "left", hireDate: "2026-01-15", departureDate: "2026-01-10" }),
    ).rejects.toThrow(/postérieure/);
    await expect(
      makeEmployee({ hireDate: "2026-01-15", departureDate: "2026-02-01" }),
    ).rejects.toThrow(/actif ou suspendu/);

    const left = await makeEmployee({
      status: "left",
      hireDate: "2026-01-15",
      departureDate: "2026-02-01",
    });
    const fiche = await getEmployee(db, {
      tenantId: ids.tenantId,
      employeeId: left.id,
      showSalary: true,
      today: TODAY,
    });
    expect(fiche?.statusLabel).toBe("Sorti");
  });

  it("refuse un manager qui est soi-même, hors espace ou déjà sorti", async () => {
    const employee = await makeEmployee();
    await expect(
      updateEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: employee.id,
        raw: {
          code: employee.code,
          lastName: "Nom",
          firstName: "Awa",
          hireDate: "2026-01-15",
          managerEmployeeId: employee.id,
        },
      }),
    ).rejects.toThrow(/propre manager/);

    const outsider = await makeEmployee({
      tenantId: ids.otherTenantId,
      actorUserId: ids.otherTenantUserId,
    });
    await expect(
      updateEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: employee.id,
        raw: {
          code: employee.code,
          lastName: "Nom",
          firstName: "Awa",
          hireDate: "2026-01-15",
          managerEmployeeId: outsider.id,
        },
      }),
    ).rejects.toThrow(/introuvable/);

    const retired = await makeEmployee({ status: "left", departureDate: "2026-03-01" });
    await expect(
      updateEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: employee.id,
        raw: {
          code: employee.code,
          lastName: "Nom",
          firstName: "Awa",
          hireDate: "2026-01-15",
          managerEmployeeId: retired.id,
        },
      }),
    ).rejects.toThrow(/sorti de l'effectif/);
  });

  it("rattache une fiche à un compte membre de l'espace seulement", async () => {
    const employee = await makeEmployee();
    await expect(
      linkEmployeeUser(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: employee.id,
        userId: ids.otherTenantUserId,
      }),
    ).rejects.toThrow(/pas membre/);

    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      userId: ids.otherUserId,
    });
    const linked = await getEmployee(db, {
      tenantId: ids.tenantId,
      employeeId: employee.id,
      showSalary: false,
      today: TODAY,
    });
    expect(linked?.userId).toBe(ids.otherUserId);

    const second = await makeEmployee();
    await expect(
      linkEmployeeUser(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: second.id,
        userId: ids.otherUserId,
      }),
    ).rejects.toThrow(/déjà rattaché/);

    await unlinkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
    });
    const unlinked = await getEmployee(db, {
      tenantId: ids.tenantId,
      employeeId: employee.id,
      showSalary: false,
      today: TODAY,
    });
    expect(unlinked?.userId).toBeNull();
  });

  it("ne change aucun droit au rattachement d'un compte", async () => {
    const employee = await makeEmployee();
    const before = await db
      .select({ total: sql<number>`count(*)` })
      .from(moduleGrants)
      .where(eq(moduleGrants.userId, ids.otherUserId));
    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      userId: ids.otherUserId,
    });
    const after = await db
      .select({ total: sql<number>`count(*)` })
      .from(moduleGrants)
      .where(eq(moduleGrants.userId, ids.otherUserId));
    expect(after[0]?.total).toBe(before[0]?.total);
    expect(resolveLevels("member", {}).hr).toBe("none");
    await unlinkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
    });
  });

  it("refuse la sortie d'un salarié responsable d'un service ou manager d'un autre", async () => {
    const responsible = await makeEmployee();
    const department = await makeDepartment({ responsibleEmployeeId: responsible.id });
    await expect(
      updateEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: responsible.id,
        raw: {
          code: responsible.code,
          lastName: "Nom",
          firstName: "Awa",
          hireDate: "2026-01-15",
          status: "left",
          departureDate: "2026-06-01",
        },
      }),
    ).rejects.toThrow(/responsable du service/);
    await unlinkDepartmentResponsible(department.id);

    const manager = await makeEmployee();
    await makeEmployee({ managerEmployeeId: manager.id });
    await expect(
      updateEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: manager.id,
        raw: {
          code: manager.code,
          lastName: "Nom",
          firstName: "Awa",
          hireDate: "2026-01-15",
          status: "left",
          departureDate: "2026-06-01",
        },
      }),
    ).rejects.toThrow(/manager/);
  });

  it("refuse la suppression d'une fiche qui a des contrats", async () => {
    const employee = await makeEmployee();
    const contract = await makeContract(employee.id);
    await expect(
      deleteEmployee(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        employeeId: employee.id,
      }),
    ).rejects.toThrow(/contrat/);
    await deleteContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });
    await deleteEmployee(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
    });
    const gone = await getEmployee(db, {
      tenantId: ids.tenantId,
      employeeId: employee.id,
      showSalary: false,
      today: TODAY,
    });
    expect(gone).toBeNull();
  });

  it("isole une fiche d'un autre espace en lecture comme en écriture", async () => {
    const employee = await makeEmployee();
    expect(
      await getEmployee(db, {
        tenantId: ids.otherTenantId,
        employeeId: employee.id,
        showSalary: true,
        today: TODAY,
      }),
    ).toBeNull();
    await expect(
      updateEmployee(db, {
        tenantId: ids.otherTenantId,
        actorUserId: ids.otherTenantUserId,
        employeeId: employee.id,
        raw: { code: employee.code, lastName: "Nom", firstName: "Awa", hireDate: "2026-01-15" },
      }),
    ).rejects.toThrow(/introuvable/);
  });
});

async function unlinkDepartmentResponsible(departmentId: string): Promise<void> {
  await updateDepartment(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    departmentId,
    raw: { code: await departmentCode(departmentId), name: await departmentName(departmentId) },
  });
}

async function departmentCode(departmentId: string): Promise<string> {
  const departments = await listDepartments(db, { tenantId: ids.tenantId });
  const row = departments.find((department) => department.id === departmentId);
  if (!row) {
    throw new Error("Service introuvable.");
  }
  return row.code;
}

async function departmentName(departmentId: string): Promise<string> {
  const departments = await listDepartments(db, { tenantId: ids.tenantId });
  const row = departments.find((department) => department.id === departmentId);
  if (!row) {
    throw new Error("Service introuvable.");
  }
  return row.name;
}

describe("HR-004 — contrat de travail", () => {
  it("exige une date de fin pour un CDD et la refuse antérieure au début", async () => {
    const employee = await makeEmployee();
    await expect(makeContract(employee.id, { kind: "cdd" })).rejects.toThrow(
      /Date de fin : obligatoire/,
    );
    await expect(makeContract(employee.id, { kind: "cdd", endDate: "2026-01-10" })).rejects.toThrow(
      /postérieure/,
    );
    const created = await makeContract(employee.id, { kind: "cdd", endDate: "2026-12-31" });
    expect(created.id).toBeTruthy();
  });

  it("refuse une période d'essai plus longue que le contrat", async () => {
    const employee = await makeEmployee();
    await expect(
      makeContract(employee.id, { kind: "cdd", endDate: "2026-06-30", trialPeriodDays: "300" }),
    ).rejects.toThrow(/Période d'essai/);
  });

  it("refuse une durée hebdomadaire hors 0 à 80 et un salaire non entier", async () => {
    const employee = await makeEmployee();
    await expect(makeContract(employee.id, { weeklyHours: "80.5" })).rejects.toThrow(/80 heures/);
    await expect(makeContract(employee.id, { salaryXof: "2500.50" })).rejects.toThrow(/entier/);
    await expect(makeContract(employee.id, { salaryXof: "-1" })).rejects.toThrow(/entier/);
  });

  it("refuse un deuxième contrat en cours sur la même fiche", async () => {
    const employee = await makeEmployee();
    const first = await makeContract(employee.id);
    const second = await makeContract(employee.id, {
      startDate: "2026-02-01",
      trialPeriodDays: "0",
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: first.id,
    });
    await expect(
      startContract(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        contractId: second.id,
      }),
    ).rejects.toThrow(/déjà un contrat en cours/);

    await expect(
      db.insert(hrContracts).values([
        {
          tenantId: ids.tenantId,
          employeeId: employee.id,
          kind: "cdi",
          startDate: "2026-03-01",
          status: "running",
        },
      ]),
    ).rejects.toThrow(/running|unique|duplicate/i);
  });

  it("gèle le contrat sorti du brouillon et ne supprime que le brouillon", async () => {
    const employee = await makeEmployee();
    const draft = await makeContract(employee.id, { salaryXof: "120000" });
    await updateContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: draft.id,
      raw: {
        employeeId: employee.id,
        kind: "cdi",
        startDate: "2026-01-15",
        trialPeriodDays: "45",
        weeklyHours: "37.5",
        salaryXof: "150000",
      },
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: draft.id,
    });
    await expect(
      updateContract(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        contractId: draft.id,
        raw: {
          employeeId: employee.id,
          kind: "cdd",
          startDate: "2026-01-15",
          endDate: "2026-12-31",
          trialPeriodDays: "0",
          weeklyHours: "40",
          salaryXof: "999999",
        },
      }),
    ).rejects.toThrow(/figé/);
    await expect(
      deleteContract(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        contractId: draft.id,
      }),
    ).rejects.toThrow(/brouillon/);
  });

  it("dérive « échu » à la lecture quand la date de fin est passée", async () => {
    const employee = await makeEmployee();
    const contract = await makeContract(employee.id, {
      kind: "cdd",
      startDate: "2026-01-15",
      endDate: "2026-06-30",
      trialPeriodDays: "0",
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });

    const read = await getContract(db, {
      tenantId: ids.tenantId,
      contractId: contract.id,
      showSalary: false,
      today: TODAY,
    });
    expect(read?.displayStatus).toBe("expired");
    expect(read?.displayLabel).toBe("Échu");
    expect(read?.status).toBe("running");

    const runningOnly = await listContracts(db, {
      tenantId: ids.tenantId,
      showSalary: false,
      today: TODAY,
      status: "running",
    });
    expect(runningOnly.some((row) => row.id === contract.id)).toBe(false);
  });

  it("refuse une résiliation antérieure au début et l'enregistre sinon", async () => {
    const employee = await makeEmployee();
    const contract = await makeContract(employee.id, { trialPeriodDays: "0" });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });
    await expect(
      terminateContract(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        contractId: contract.id,
        terminatedOn: "2025-12-31",
      }),
    ).rejects.toThrow(/postérieure ou égale/);

    await terminateContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
      terminatedOn: "2026-08-31",
    });
    const read = await getContract(db, {
      tenantId: ids.tenantId,
      contractId: contract.id,
      showSalary: false,
      today: TODAY,
    });
    expect(read?.displayStatus).toBe("terminated");
    expect(read?.terminatedOn).toBe("2026-08-31");
    const audit = await latestAudit("hr_contract", contract.id);
    expect(audit.details).toMatchObject({ before: "running", after: "terminated" });
  });
});

describe("HR-005 — le salaire est une donnée sociale", () => {
  it("ne renvoie aucun salaire en lecture, le salaire en écriture", async () => {
    const employee = await makeEmployee({ code: "SAL001" });
    await makeContract(employee.id, { salaryXof: "311000" });

    const withoutSalary = await listContracts(db, {
      tenantId: ids.tenantId,
      employeeId: employee.id,
      showSalary: false,
      today: TODAY,
    });
    expect(withoutSalary[0]?.salaryXof).toBeNull();
    expect(JSON.stringify(withoutSalary)).not.toContain("311000");

    const withSalary = await listContracts(db, {
      tenantId: ids.tenantId,
      employeeId: employee.id,
      showSalary: true,
      today: TODAY,
    });
    expect(withSalary[0]?.salaryXof).toBe(311000);

    const fiches = await listEmployees(db, { tenantId: ids.tenantId, search: "SAL001" });
    expect(JSON.stringify(fiches)).not.toContain("311000");
  });

  it("n'écrit aucun montant dans l'audit d'un contrat", async () => {
    const employee = await makeEmployee();
    const contract = await makeContract(employee.id, { salaryXof: "456789" });
    const events = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(auditWhere("hr_contract", contract.id));
    const serialized = JSON.stringify(events.map((event) => event.details));
    expect(serialized).not.toContain("456789");
    expect(serialized).not.toMatch(/salary/i);
  });
});

describe("HR-007 — hub, filtres et compteurs", () => {
  it("recalcule les compteurs avec les écritures", async () => {
    const before = await getHrOverview(db, { tenantId: ids.tenantId, today: TODAY });
    const department = await makeDepartment({ name: "Service compteur" });
    const hired = await makeEmployee({ hireDate: "2026-11-05", departmentId: department.id });
    const retired = await makeEmployee({
      hireDate: "2025-05-05",
      status: "left",
      departureDate: "2026-11-07",
    });
    const contract = await makeContract(hired.id, {
      startDate: "2026-11-05",
      trialPeriodDays: "90",
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });

    const after = await getHrOverview(db, { tenantId: ids.tenantId, today: TODAY });
    expect(after.departments).toBe(before.departments + 1);
    expect(after.activeEmployees).toBe(before.activeEmployees + 1);
    expect(after.leftEmployees).toBe(before.leftEmployees + 1);
    expect(after.hiresThisMonth).toBeGreaterThanOrEqual(before.hiresThisMonth + 1);
    expect(after.departuresThisMonth).toBeGreaterThanOrEqual(before.departuresThisMonth + 1);
    expect(after.runningContracts).toBe(before.runningContracts + 1);
    expect(after.trialContracts).toBe(before.trialContracts + 1);

    await updateEmployee(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: retired.id,
      raw: {
        code: retired.code,
        lastName: "Nom",
        firstName: "Awa",
        hireDate: "2025-05-05",
        status: "left",
        departureDate: "2026-11-07",
      },
    });
  });

  it("combine les filtres service, statut et recherche", async () => {
    const department = await makeDepartment({ name: "Service filtre" });
    await makeEmployee({
      departmentId: department.id,
      code: "FIL001",
      lastName: "Coulibaly",
      firstName: "Awa",
    });
    await makeEmployee({
      departmentId: department.id,
      code: "FIL002",
      lastName: "Traore",
      firstName: "Ibra",
      status: "suspended",
    });
    await makeEmployee({ code: "FIL003", lastName: "Koné", firstName: "Awa" });

    const inDepartment = await listEmployees(db, {
      tenantId: ids.tenantId,
      departmentId: department.id,
    });
    expect(inDepartment.map((row) => row.code).sort()).toEqual(["FIL001", "FIL002"]);

    const activeOnly = await listEmployees(db, {
      tenantId: ids.tenantId,
      departmentId: department.id,
      status: "active",
    });
    expect(activeOnly.map((row) => row.code)).toEqual(["FIL001"]);

    const searched = await listEmployees(db, { tenantId: ids.tenantId, search: "coulibaly" });
    expect(searched.map((row) => row.code)).toEqual(["FIL001"]);

    const elsewhere = await listEmployees(db, { tenantId: ids.otherTenantId });
    expect(elsewhere.some((row) => row.code.startsWith("FIL"))).toBe(false);
  });

  it("cumule les effectifs de l'arbre avec ses descendants", async () => {
    const direction = await makeDepartment({ name: "Direction cumul" });
    const agence = await makeDepartment({ name: "Agence cumul", parentId: direction.id });
    await makeEmployee({ departmentId: direction.id });
    await makeEmployee({ departmentId: agence.id });
    await makeEmployee({ departmentId: agence.id, status: "suspended" });

    const tree = await getDepartmentTree(db, { tenantId: ids.tenantId });
    const node = findNode(tree, direction.id);
    expect(node?.headcount).toBe(1);
    expect(node?.totalHeadcount).toBe(3);
    expect(node?.children.some((child) => child.id === agence.id)).toBe(true);
  });

  it("sort un contrat échu du compteur des contrats en cours sans écriture", async () => {
    const employee = await makeEmployee();
    const contract = await makeContract(employee.id, {
      kind: "cdd",
      startDate: "2026-01-15",
      endDate: "2026-06-30",
      trialPeriodDays: "0",
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });

    const beforeExpiry = await getHrOverview(db, {
      tenantId: ids.tenantId,
      today: "2026-06-01",
      employeeId: employee.id,
    });
    const afterExpiry = await getHrOverview(db, {
      tenantId: ids.tenantId,
      today: TODAY,
      employeeId: employee.id,
    });
    expect(beforeExpiry.runningContracts).toBe(1);
    expect(afterExpiry.runningContracts).toBe(beforeExpiry.runningContracts - 1);
  });
});

describe("HR-008 — audit et survie de la fiche", () => {
  it("trace chaque mutation avec avant et après en français", async () => {
    const employee = await makeEmployee({
      code: "AUD001",
      lastName: "Diomande",
      firstName: "Moussa",
    });
    const created = await latestAudit("hr_employee", employee.id);
    expect(created.action).toBe("hr.employee.create");
    expect(created.details).toMatchObject({ code: "AUD001", fullName: "DIOMANDE Moussa" });

    await updateEmployee(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      raw: {
        code: "AUD001",
        lastName: "Diomande",
        firstName: "Moussa",
        position: "Magasinier",
        hireDate: "2026-01-15",
        status: "suspended",
      },
    });
    const updated = await latestAudit("hr_employee", employee.id);
    expect(updated.action).toBe("hr.employee.update");
    const details = updated.details as {
      before: { status: string };
      after: { status: string };
    };
    expect(details.before.status).toBe("active");
    expect(details.after.status).toBe("suspended");

    const link = await linkAuditAction(employee.id);
    expect(link).toBe("hr.employee.unlink");
  });

  it("laisse la fiche survivre avec un lien null quand le compte est supprimé", async () => {
    const employee = await makeEmployee();
    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: employee.id,
      userId: ids.otherUserId,
    });
    await db.delete(users).where(eq(users.id, ids.otherUserId));

    const [fiche] = await db
      .select({ id: hrEmployees.id, userId: hrEmployees.userId, code: hrEmployees.code })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ids.tenantId), eq(hrEmployees.id, employee.id)));
    expect(fiche?.userId).toBeNull();
    expect(fiche?.code).toBeTruthy();
  });
});

async function linkAuditAction(employeeId: string): Promise<string> {
  await linkEmployeeUser(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    employeeId,
    userId: (await spareMember()).id,
  });
  await unlinkEmployeeUser(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    employeeId,
  });
  return (await latestAudit("hr_employee", employeeId)).action;
}

async function spareMember(): Promise<{ id: string }> {
  const sequence = Math.floor(Math.random() * 1_000_000).toString(36);
  const [created] = await db
    .insert(users)
    .values({
      email: `spare-${sequence}@test.local`,
      name: "Compte de passage",
      passwordHash: "hash-test",
    })
    .returning({ id: users.id });
  if (!created) {
    throw new Error("Compte de test non créé.");
  }
  const { memberships } = await import("@/db/schema");
  await db
    .insert(memberships)
    .values({ tenantId: ids.tenantId, userId: created.id, role: "member" });
  return created;
}

function findNode(
  nodes: readonly { id: string; children: readonly unknown[] }[],
  id: string,
):
  | { id: string; headcount: number; totalHeadcount: number; children: readonly { id: string }[] }
  | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node as never;
    }
    const child = findNode(
      node.children as readonly { id: string; children: readonly unknown[] }[],
      id,
    );
    if (child) {
      return child;
    }
  }
  return undefined;
}
