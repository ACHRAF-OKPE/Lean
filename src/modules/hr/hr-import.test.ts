import { createHash } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, hrContracts, hrEmployees, importRows } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import {
  HEADERS_BY_KIND,
  HR_EMPLOYEE_HEADERS,
  IMPORT_TEMPLATE_PATHS,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
} from "@/modules/catalog/constants";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import { buildTemplate, templateFileName } from "@/modules/catalog/xlsx";
import type { RawImportRow } from "@/modules/catalog/validation";
import {
  createContract,
  createDepartment,
  createEmployee,
  linkEmployeeUser,
  listEmployees,
  startContract,
} from "./queries";

type LoadInput = Parameters<Workbook["xlsx"]["load"]>[0];

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

function hashOf(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

function employeeRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      matricule: "IMP0001",
      nom: "DIALLO",
      prenom: "Aminata",
      poste: "Responsable logistique",
      date_embauche: "2026-03-01",
      code_service: "",
      matricule_manager: "",
      compte_email: "",
      statut: "Actif",
      ...overrides,
    },
  };
}

async function analyzePersonnel(
  ids: HrTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("personnel"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "hr_employees",
    fileName: "personnel.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function makeDepartment(tenantId: string, userId: string, code: string, name: string) {
  return createDepartment(db, { tenantId, actorUserId: userId, raw: { code, name } });
}

async function makeEmployee(
  tenantId: string,
  userId: string,
  code: string,
  overrides: Record<string, string | undefined> = {},
) {
  return createEmployee(db, {
    tenantId,
    actorUserId: userId,
    raw: {
      code,
      lastName: "NOM",
      firstName: "Existant",
      hireDate: "2025-01-15",
      ...overrides,
    },
  });
}

async function employeeCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(hrEmployees)
    .where(eq(hrEmployees.tenantId, tenantId));
  return row?.value ?? 0;
}

async function messagesOf(tenantId: string, batchId: string): Promise<string[]> {
  const detail = await getImportBatch(db, { tenantId, batchId });
  return (detail?.rows ?? []).map((row) => [...row.errors, ...row.warnings].join(" | "));
}

describe("HR-006 — modèle d'import du personnel", () => {
  it("expose neuf colonnes, la liste des statuts et un slug public", async () => {
    expect([...HR_EMPLOYEE_HEADERS]).toEqual([
      "matricule",
      "nom",
      "prenom",
      "poste",
      "date_embauche",
      "code_service",
      "matricule_manager",
      "compte_email",
      "statut",
    ]);
    expect([...HEADERS_BY_KIND.hr_employees]).toEqual([...HR_EMPLOYEE_HEADERS]);
    expect(IMPORT_TEMPLATE_PATHS.hr_employees).toBe("/api/modeles/personnel");
    expect(templateFileName("hr_employees")).toBe("lean-modele-personnel.xlsx");

    const workbook = await loadWorkbook(await buildTemplate("hr_employees"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

    const headers = HR_EMPLOYEE_HEADERS.map((_, index) => data?.getRow(1).getCell(index + 1).value);
    expect(headers).toEqual([...HR_EMPLOYEE_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getColumn(5).numFmt).toBe("@");
    expect(data?.getCell("I2").dataValidation?.formulae).toEqual(['"Actif,Suspendu,Sorti"']);
  });
});

describe("HR-006 — analyse sans écriture", () => {
  it("bloque chaque référence invalide et n'écrit aucune fiche", async () => {
    const ids = await seedHrTenant(db, "hr-006-erreurs");
    const manager = await makeEmployee(ids.tenantId, ids.userId, "MGR0001");
    await makeEmployee(ids.tenantId, ids.userId, "SORTI01", {
      status: "left",
      departureDate: "2026-06-30",
    });
    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: manager.id,
      userId: ids.otherUserId,
    });
    await makeDepartment(ids.otherTenantId, ids.otherTenantUserId, "LOG", "Logistique voisine");

    const rows = [
      employeeRow(2, { matricule: "" }),
      employeeRow(3, { matricule: "IMP0003", nom: "" }),
      employeeRow(4, { matricule: "IMP0003", prenom: "" }),
      employeeRow(5, { matricule: "IMP0005", date_embauche: "01/03/2026" }),
      employeeRow(6, { matricule: "IMP0006", code_service: "INCONNU" }),
      employeeRow(7, { matricule: "IMP0007", code_service: "LOG" }),
      employeeRow(8, { matricule: "MGR0001", matricule_manager: "MGR0001" }),
      employeeRow(9, { matricule: "IMP0009", matricule_manager: "SORTI01" }),
      employeeRow(10, { matricule: "IMP0010", compte_email: "inconnu@exemple.sn" }),
      employeeRow(11, { matricule: "IMP0011", compte_email: ids.otherTenantEmail }),
      employeeRow(12, { matricule: "IMP0012", compte_email: ids.memberEmail }),
      employeeRow(13, { matricule: "IMP0013", statut: "Contractuel" }),
      employeeRow(14, { matricule: "IMP0014", statut: "Sorti" }),
      employeeRow(15, { matricule: "TROP_LONG_MATRICULE_2026" }),
    ];

    const analysis = await analyzePersonnel(ids, rows, hashOf("hr-006-erreurs"));
    expect(analysis.errorCount).toBe(14);
    expect(analysis.warningCount).toBe(0);
    expect(await employeeCount(ids.tenantId)).toBe(2);

    const messages = await messagesOf(ids.tenantId, analysis.batchId);
    expect(messages[0]).toContain("Matricule : obligatoire");
    expect(messages[1]).toContain("Nom : obligatoire");
    expect(messages[2]).toContain("présent plusieurs fois dans le fichier (lignes 3, 4)");
    expect(messages[3]).toContain("Date d'embauche : date AAAA-MM-JJ attendue");
    expect(messages[4]).toContain("Service INCONNU : code inconnu");
    expect(messages[5]).toContain("Service LOG : code inconnu");
    expect(messages[6]).toContain("son propre manager");
    expect(messages[7]).toContain("SORTI01 : ce salarié est sorti");
    expect(messages[8]).toContain("aucun membre de l'espace");
    expect(messages[9]).toContain("aucun membre de l'espace");
    expect(messages[10]).toContain("déjà rattaché à une autre fiche");
    expect(messages[11]).toContain("Statut « Contractuel » inconnu");
    expect(messages[12]).toContain("date de sortie");
    expect(messages[13]).toContain("1 à 16 caractères");

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/en erreur/);
    expect(await employeeCount(ids.tenantId)).toBe(2);
  });

  it("avertit sur un matricule existant et signale ce que la cellule laisse vide", async () => {
    const ids = await seedHrTenant(db, "hr-006-avertissements");
    const department = await makeDepartment(ids.tenantId, ids.userId, "COM", "Comptabilité");
    const manager = await makeEmployee(ids.tenantId, ids.userId, "DIR0001");
    const existing = await makeEmployee(ids.tenantId, ids.userId, "EMP1001", {
      departmentId: department.id,
      managerEmployeeId: manager.id,
      status: "suspended",
    });
    await linkEmployeeUser(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      employeeId: existing.id,
      userId: ids.otherUserId,
    });

    const analysis = await analyzePersonnel(
      ids,
      [
        employeeRow(2, {
          matricule: "emp1001",
          nom: "OKPE",
          prenom: "Edith",
          date_embauche: "2025-01-15",
        }),
        employeeRow(3, { matricule: "EMP1002", statut: "" }),
      ],
      hashOf("hr-006-avertissements"),
    );

    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);
    expect(analysis.notes.join(" ")).toContain("2 fiches seront écrites à la confirmation");
    expect(analysis.notes.join(" ")).toContain("1 création(s), 1 mise(s à jour)");

    const detail = await getImportBatch(db, { tenantId: ids.tenantId, batchId: analysis.batchId });
    expect(detail?.rows.map((row) => row.status)).toEqual(["warning", "warning"]);
    expect(detail?.rows[0]?.warnings.join(" ")).toContain("normalisé en majuscules");
    expect(detail?.rows[0]?.warnings.join(" ")).toContain("EMP1001 déjà présent");
    expect(detail?.rows[1]?.warnings.join(" ")).toContain("« Actif » retenu");
  });
});

describe("HR-006 — application du lot", () => {
  it("crée, met à jour, rattache un compte et audite le lot sans aucun montant", async () => {
    const ids = await seedHrTenant(db, "hr-006-application");
    const other = await seedHrTenant(db, "hr-006-voisin");
    await makeDepartment(ids.tenantId, ids.userId, "LOG", "Service logistique");
    const manager = await makeEmployee(ids.tenantId, ids.userId, "DIR0002");
    const existing = await makeEmployee(ids.tenantId, ids.userId, "EMP2001");

    const contract = await createContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        employeeId: existing.id,
        kind: "cdi",
        startDate: "2025-01-15",
        trialPeriodDays: "0",
        weeklyHours: "40",
        salaryXof: "450000",
      },
    });
    await startContract(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      contractId: contract.id,
    });

    const rows = [
      employeeRow(2, {
        matricule: "EMP2001",
        nom: "TRAORE",
        prenom: "Moussa",
        poste: "Magasinier",
        date_embauche: "2025-01-15",
        code_service: "log",
        matricule_manager: "dir0002",
        compte_email: ids.memberEmail,
      }),
      employeeRow(3, {
        matricule: "emp2002",
        nom: "KAMARA",
        prenom: "Fatou",
        poste: "",
        date_embauche: "2026-05-01",
        code_service: "LOG",
        statut: "Suspendu",
      }),
    ];
    const hash = hashOf("hr-006-application");
    const analysis = await analyzePersonnel(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ kind: "hr_employees", written: 2 });

    const fiches = await listEmployees(db, { tenantId: ids.tenantId });
    const updated = fiches.find((employee) => employee.code === "EMP2001");
    const created = fiches.find((employee) => employee.code === "EMP2002");
    expect(updated).toMatchObject({
      lastName: "TRAORE",
      firstName: "Moussa",
      position: "Magasinier",
      departmentCode: "LOG",
      status: "active",
    });
    expect(updated?.managerEmployeeId).toBe(manager.id);
    expect(updated?.userId).toBe(ids.otherUserId);
    expect(created).toMatchObject({
      lastName: "KAMARA",
      firstName: "Fatou",
      position: null,
      status: "suspended",
      userId: null,
    });

    const linked = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linked).toHaveLength(2);
    expect(linked.every((row) => row.entityId !== null)).toBe(true);

    const audits = await db
      .select({ action: auditEvents.action, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.entityType, "import_batch"),
          eq(auditEvents.entityId, analysis.batchId),
        ),
      );
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      "catalog.import.apply",
      "hr.employee.import",
    ]);
    const serialized = JSON.stringify(audits.map((audit) => audit.details));
    expect(serialized).not.toMatch(/salary/i);
    expect(serialized).not.toContain("450000");

    const [salaryStillThere] = await db
      .select({ salaryXof: hrContracts.salaryXof })
      .from(hrContracts)
      .where(eq(hrContracts.id, contract.id));
    expect(salaryStillThere?.salaryXof).toBe(450000);

    const voisines = await db
      .select({ code: hrEmployees.code })
      .from(hrEmployees)
      .where(eq(hrEmployees.tenantId, other.tenantId));
    expect(voisines).toEqual([]);
    expect(await employeeCount(ids.tenantId)).toBe(3);

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);

    const duplicate = await analyzePersonnel(ids, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: duplicate.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été importé en personnel/);
    expect(await employeeCount(ids.tenantId)).toBe(3);
  });

  it("refuse de réactiver une fiche sortie et conserve sa date de sortie", async () => {
    const ids = await seedHrTenant(db, "hr-006-sortie");
    await makeEmployee(ids.tenantId, ids.userId, "EMP3001", {
      status: "left",
      departureDate: "2026-08-31",
    });

    const analysis = await analyzePersonnel(
      ids,
      [employeeRow(2, { matricule: "EMP3001", nom: "BARRY", statut: "Actif" })],
      hashOf("hr-006-sortie"),
    );
    expect(analysis.errorCount).toBe(0);

    const detail = await getImportBatch(db, { tenantId: ids.tenantId, batchId: analysis.batchId });
    expect(detail?.rows[0]?.warnings.join(" ")).toContain("ne la réactive pas");

    await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });

    const [fiche] = await db
      .select({ status: hrEmployees.status, departureDate: hrEmployees.departureDate })
      .from(hrEmployees)
      .where(and(eq(hrEmployees.tenantId, ids.tenantId), eq(hrEmployees.code, "EMP3001")));
    expect(fiche).toMatchObject({ status: "left", departureDate: "2026-08-31" });
  });
});
