import { createHash } from "node:crypto";
import { Workbook, type CellValue } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, discussionMessages, importRows, tasks, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCollaborationTenant, type CollaborationTenant } from "@/test/collaboration";
import {
  HEADERS_BY_KIND,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
  TASK_HEADERS,
} from "@/modules/catalog/constants";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import { buildTemplate, parseWorkbook } from "@/modules/catalog/xlsx";
import type { RawImportRow } from "@/modules/catalog/validation";
import { createTask } from "./queries";

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

function taskRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      titre: "Relancer le règlement",
      description: "",
      priorite: "Normale",
      echeance: "",
      assigne_email: "",
      document_type: "",
      document_reference: "",
      ...overrides,
    },
  };
}

async function analyze(
  ids: CollaborationTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("taches"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "tasks",
    fileName: "taches.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function emailOf(userId: string): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!row) {
    throw new Error("Utilisateur de test introuvable.");
  }
  return row.email;
}

async function taskCount(tenantId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(tasks).where(eq(tasks.tenantId, tenantId));
  return row?.value ?? 0;
}

async function workbookBytes(workbook: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const written = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(written as ArrayBuffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

describe("TSK-005 — modèle XLSX des tâches", () => {
  it("produit un modèle à sept colonnes avec listes et colonnes texte", async () => {
    expect([...TASK_HEADERS]).toEqual([
      "titre",
      "description",
      "priorite",
      "echeance",
      "assigne_email",
      "document_type",
      "document_reference",
    ]);
    expect([...HEADERS_BY_KIND.tasks]).toEqual([...TASK_HEADERS]);

    const workbook = await loadWorkbook(await buildTemplate("tasks"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

    const headers = TASK_HEADERS.map((_, index) => data?.getRow(1).getCell(index + 1).value);
    expect(headers).toEqual([...TASK_HEADERS]);
    expect(data?.getColumn(4).numFmt).toBe("@");
    expect(data?.getColumn(7).numFmt).toBe("@");
    expect(data?.getCell("C2").dataValidation.formulae).toEqual(['"Basse,Normale,Haute,Urgente"']);
    expect(data?.getCell("F2").dataValidation.formulae).toEqual([
      '"Tiers,Commande fournisseur,Commande client,Facture"',
    ]);
  });

  it("refuse un en-tête non conforme avant toute analyse", async () => {
    const header: string[] = [...TASK_HEADERS];
    header[0] = "objet";
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(SHEET_DATA);
    sheet.addRow(header);
    sheet.getRow(2).values = ["Relancer le règlement"] as CellValue[];

    await expect(parseWorkbook("tasks", await workbookBytes(workbook))).rejects.toThrow(
      /En-têtes non conformes/,
    );
  });
});

describe("TSK-005 — analyse et application", () => {
  it("n'écrit rien à l'analyse, puis crée des tâches ouvertes attribuées à l'acteur", async () => {
    const tenant = await seedCollaborationTenant(db, "tsk-005-apply");
    const memberEmail = await emailOf(tenant.memberUserId);
    const hash = hashOf("tsk-005-apply");

    const rows = [
      taskRow(2, {
        titre: "Relancer la facture FAC-2026-014",
        description: "  Appeler le fournisseur avant échéance  ",
        priorite: "Haute",
        echeance: "2099-11-05",
        assigne_email: memberEmail,
        document_type: "Tiers",
        document_reference: "four001",
      }),
      taskRow(3, {
        titre: "  Vérifier le classement tarifaire  ",
        priorite: "",
        echeance: "2020-01-10",
      }),
      taskRow(4, {
        titre: "Préparer la relance client",
        priorite: "Basse",
      }),
    ];

    const analysis = await analyze(tenant, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);
    expect(await taskCount(tenant.tenantId)).toBe(0);

    const detail = await getImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.map((row) => row.status)).toEqual(["warning", "warning", "valid"]);

    const applied = await applyImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
      actorUserId: tenant.userId,
    });
    expect(applied).toMatchObject({ kind: "tasks", written: 3 });

    const stored = await db
      .select()
      .from(tasks)
      .where(eq(tasks.tenantId, tenant.tenantId))
      .orderBy(asc(tasks.title));
    expect(stored).toHaveLength(3);
    for (const task of stored) {
      expect(task.status).toBe("open");
      expect(task.createdByUserId).toBe(tenant.userId);
      expect(task.completedAt).toBeNull();
      expect(task.revision).toBe(0);
    }

    const linked = stored.find((task) => task.title === "Relancer la facture FAC-2026-014");
    expect(linked).toMatchObject({
      description: "Appeler le fournisseur avant échéance",
      priority: "high",
      dueDate: "2099-11-05",
      assigneeUserId: tenant.memberUserId,
      relatedEntityType: "partner",
      relatedEntityId: tenant.supplierId,
    });

    const normalized = stored.find((task) => task.title === "Vérifier le classement tarifaire");
    expect(normalized).toMatchObject({
      description: "",
      priority: "normal",
      dueDate: "2020-01-10",
      assigneeUserId: null,
      relatedEntityType: null,
      relatedEntityId: null,
    });

    const linkedRows = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linkedRows).toHaveLength(3);
    expect(linkedRows.every((row) => row.entityId !== null)).toBe(true);

    const audits = await db
      .select({ details: auditEvents.details, entityType: auditEvents.entityType })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenant.tenantId), eq(auditEvents.action, "task.import")));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityType).toBe("import_batch");
    expect(audits[0]?.details).toMatchObject({
      source: "xlsx_import",
      batchId: analysis.batchId,
      count: 3,
    });

    const events = await db
      .select({ id: discussionMessages.id })
      .from(discussionMessages)
      .where(
        and(
          eq(discussionMessages.tenantId, tenant.tenantId),
          eq(discussionMessages.entityType, "task"),
          inArray(
            discussionMessages.entityId,
            stored.map((task) => task.id),
          ),
        ),
      );
    expect(events).toHaveLength(0);

    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: analysis.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);
    expect(await taskCount(tenant.tenantId)).toBe(3);

    const duplicate = await analyze(tenant, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: duplicate.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/déjà été importé/);
    expect(await taskCount(tenant.tenantId)).toBe(3);
  });

  it("bloque l'application tant qu'une erreur subsiste et n'écrit rien", async () => {
    const tenant = await seedCollaborationTenant(db, "tsk-005-errors");

    const rows = [
      taskRow(2, { titre: "" }),
      taskRow(3, { titre: "Priorité inconnue", priorite: "Immédiate" }),
      taskRow(4, { titre: "Date invalide", echeance: "31/12/2026" }),
      taskRow(5, { titre: "Assigné inconnu", assigne_email: "inconnu@exemple.sn" }),
      taskRow(6, {
        titre: "Document inconnu",
        document_type: "Facture",
        document_reference: "FAC-999",
      }),
      taskRow(7, { titre: "Type sans référence", document_type: "Tiers" }),
      taskRow(8, { titre: "Référence sans type", document_reference: "FOUR001" }),
    ];

    const analysis = await analyze(tenant, rows, hashOf("tsk-005-errors"));
    expect(analysis.errorCount).toBe(7);
    expect(analysis.warningCount).toBe(0);

    const detail = await getImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.every((row) => row.status === "error")).toBe(true);
    const messages = detail?.rows.flatMap((row) => row.errors).join(" ") ?? "";
    expect(messages).toContain("Titre : obligatoire.");
    expect(messages).toContain("Priorité inconnue");
    expect(messages).toContain("Échéance : date AAAA-MM-JJ attendue.");
    expect(messages).toContain("aucun membre de l'espace ne porte cette adresse");
    expect(messages).toContain("Facture FAC-999 : document introuvable");
    expect(messages).toContain("Référence du document : obligatoire");
    expect(messages).toContain("Type de document : obligatoire");

    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: analysis.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/lignes sont en erreur/);
    expect(await taskCount(tenant.tenantId)).toBe(0);
  });

  it("signale un titre déjà ouvert comme avertissement sans bloquer l'import", async () => {
    const tenant = await seedCollaborationTenant(db, "tsk-005-doublon");
    await createTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        title: "Relancer le règlement",
        description: "",
        priority: "normal",
        dueDate: "",
        assigneeUserId: "",
        relatedEntityType: "",
        relatedEntityId: "",
      },
    });

    const analysis = await analyze(
      tenant,
      [taskRow(2, { titre: "Relancer le règlement  " })],
      hashOf("tsk-005-doublon"),
    );
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(1);

    await applyImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
      actorUserId: tenant.userId,
    });

    const stored = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.tenantId, tenant.tenantId));
    expect(stored).toHaveLength(2);
    expect(stored.every((task) => task.title === "Relancer le règlement")).toBe(true);
  });
});
