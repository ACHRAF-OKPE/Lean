import { createHash } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, customsDeclarationLines, importRows } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCustomsTenant, type CustomsTenant } from "@/test/customs";
import {
  CUSTOMS_LINE_HEADERS,
  HEADERS_BY_KIND,
  SHEET_DATA,
  SHEET_HELP,
  SHEET_REFERENCES,
} from "@/modules/catalog/constants";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import { buildTemplate } from "@/modules/catalog/xlsx";
import type { RawImportRow } from "@/modules/catalog/validation";
import { addDeclarationLine, changeDeclarationStatus, createDeclaration } from "./queries";

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

async function createDraft(
  ids: CustomsTenant,
  date = "2026-10-15",
): Promise<{ id: string; number: string }> {
  return createDeclaration(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: {
      regimeId: ids.plainRegimeId,
      officeId: ids.officeId,
      partnerId: ids.partnerId,
      declarationDate: date,
      externalReference: "",
      freightAmountXof: 0,
      insuranceAmountXof: 0,
    },
  });
}

async function addLine(declarationId: string, ids: CustomsTenant, designation = "Ligne initiale") {
  return addDeclarationLine(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    declarationId,
    raw: {
      hsCode: ids.hsCode,
      designation,
      quantity: "5",
      unitCode: "KG",
      valueXof: 500_000,
      weightKg: "",
      originCountry: "CI",
    },
  });
}

function lineRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      numero_declaration: "DEC-2026-0001",
      code_sh: "090111",
      designation: "Café vert en sacs",
      quantite: "120",
      unite: "SAC",
      valeur_xof: "18000000",
      poids_kg: "60",
      pays_origine: "CI",
      ...overrides,
    },
  };
}

async function analyze(
  ids: CustomsTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("declarations"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "customs_lines",
    fileName: "declarations.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function lineCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(customsDeclarationLines)
    .where(eq(customsDeclarationLines.tenantId, tenantId));
  return row?.value ?? 0;
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

describe("CUS-006 — modèle XLSX des lignes de déclaration", () => {
  it("produit un modèle à huit colonnes aligné sur la nomenclature et les unités", async () => {
    expect([...CUSTOMS_LINE_HEADERS]).toEqual([
      "numero_declaration",
      "code_sh",
      "designation",
      "quantite",
      "unite",
      "valeur_xof",
      "poids_kg",
      "pays_origine",
    ]);
    expect([...HEADERS_BY_KIND.customs_lines]).toEqual([...CUSTOMS_LINE_HEADERS]);

    const workbook = await loadWorkbook(await buildTemplate("customs_lines"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

    const headers = CUSTOMS_LINE_HEADERS.map(
      (_, index) => data?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...CUSTOMS_LINE_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getColumn(2).numFmt).toBe("@");
    expect(data?.getColumn(4).numFmt).toBe("@");
    expect(data?.getCell("E2").dataValidation.formulae).toEqual([
      '"PCE,KG,G,T,L,ML,M,M2,M3,H,J,KWH,BX,CT,SAC,PAL,ROL,SET,PAQ,DZ"',
    ]);
  });
});

describe("CUS-006 — analyse et application par déclaration", () => {
  it("n'écrit rien à l'analyse puis ajoute les lignes en fin de chaque déclaration brouillon", async () => {
    const tenant = await seedCustomsTenant(db, "cus-006-apply");
    const first = await createDraft(tenant, "2026-10-15");
    const second = await createDraft(tenant, "2026-10-16");
    await addLine(first.id, tenant);

    const hash = hashOf("cus-006-apply");
    const rows = [
      lineRow(2, { numero_declaration: first.number }),
      lineRow(3, {
        numero_declaration: first.number,
        code_sh: "170199",
        designation: "Sucre blanc",
        quantite: "50",
        unite: "KG",
        valeur_xof: "5000000",
        poids_kg: "",
      }),
      lineRow(4, {
        numero_declaration: second.number,
        designation: "Café vert reconditionné",
        quantite: "10",
        unite: "KG",
        valeur_xof: "1000000",
        poids_kg: "",
      }),
      lineRow(5, {
        numero_declaration: second.number,
        code_sh: tenant.missingTecHsCode,
        designation: "Code sans taux TEC",
        quantite: "2",
        unite: "KG",
        valeur_xof: "200000",
        poids_kg: "",
      }),
    ];

    const analysis = await analyze(tenant, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);
    expect(await lineCount(tenant.tenantId)).toBe(1);
    expect(analysis.notes.join(" ")).toContain("2 déclarations en brouillon recevront des lignes");

    const detail = await getImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.map((row) => row.status)).toEqual(["warning", "valid", "valid", "warning"]);
    expect(detail?.rows[0]?.warnings.join(" ")).toContain(
      "Code SH 090111 déjà déclaré sur cette déclaration",
    );
    expect(detail?.rows[3]?.warnings.join(" ")).toContain("sans taux TEC");

    const applied = await applyImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
      actorUserId: tenant.userId,
    });
    expect(applied).toMatchObject({ kind: "customs_lines", written: 4 });
    expect(await lineCount(tenant.tenantId)).toBe(5);

    const firstLines = await db
      .select({
        lineNumber: customsDeclarationLines.lineNumber,
        hsCode: customsDeclarationLines.hsCode,
        designation: customsDeclarationLines.designation,
        quantity: customsDeclarationLines.quantity,
        unitCode: customsDeclarationLines.unitCode,
        valueXof: customsDeclarationLines.valueXof,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, tenant.tenantId),
          eq(customsDeclarationLines.declarationId, first.id),
        ),
      )
      .orderBy(asc(customsDeclarationLines.lineNumber));
    expect(firstLines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
    expect(firstLines[1]).toMatchObject({
      hsCode: "090111",
      designation: "Café vert en sacs",
      quantity: "120.000000",
      unitCode: "SAC",
      valueXof: 18_000_000,
    });
    expect(firstLines[2]).toMatchObject({ hsCode: "170199", designation: "Sucre blanc" });

    const secondLines = await db
      .select({
        lineNumber: customsDeclarationLines.lineNumber,
        hsCode: customsDeclarationLines.hsCode,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, tenant.tenantId),
          eq(customsDeclarationLines.declarationId, second.id),
        ),
      )
      .orderBy(asc(customsDeclarationLines.lineNumber));
    expect(secondLines).toEqual([
      { lineNumber: 1, hsCode: "090111" },
      { lineNumber: 2, hsCode: tenant.missingTecHsCode },
    ]);

    const linked = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linked.map((row) => row.entityId)).toEqual([first.id, first.id, second.id, second.id]);

    const audits = await db
      .select({ entityId: auditEvents.entityId, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "customs.declaration.import"),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.entityId).sort()).toEqual([first.id, second.id].sort());
    expect(audits.every((audit) => (audit.details as { lineCount?: number }).lineCount === 2)).toBe(
      true,
    );

    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: analysis.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);

    const duplicate = await analyze(tenant, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: duplicate.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/déjà été importé/);
    expect(await lineCount(tenant.tenantId)).toBe(5);
  });

  it("refuse l'application tant qu'une ligne est en erreur et n'écrit rien", async () => {
    const tenant = await seedCustomsTenant(db, "cus-006-errors");
    const draft = await createDraft(tenant, "2026-10-15");
    const deposited = await createDraft(tenant, "2026-10-16");
    await addLine(deposited.id, tenant);
    await changeDeclarationStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      declarationId: deposited.id,
      transition: "deposit",
    });

    const hash = hashOf("cus-006-errors");
    const rows = [
      lineRow(2, { numero_declaration: "DEC-2026-0099" }),
      lineRow(3, { numero_declaration: deposited.number }),
      lineRow(4, { numero_declaration: draft.number, code_sh: "123456" }),
      lineRow(5, { numero_declaration: "DEC-26-1" }),
      lineRow(6, { numero_declaration: "" }),
      lineRow(7, { numero_declaration: draft.number, designation: "" }),
    ];

    const analysis = await analyze(tenant, rows, hash);
    expect(analysis.errorCount).toBe(6);

    const detail = await getImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.every((row) => row.status === "error")).toBe(true);
    const messages = detail?.rows.flatMap((row) => row.errors).join(" ") ?? "";
    expect(messages).toContain("Déclaration DEC-2026-0099 introuvable");
    expect(messages).toContain("non modifiable");
    expect(messages).toContain("Code SH 123456 inconnu");
    expect(messages).toContain("format DEC-AAAA-NNNN attendu");
    expect(messages).toContain("Numéro de déclaration : obligatoire.");
    expect(messages).toContain("Désignation : obligatoire.");

    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: analysis.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/lignes sont en erreur/);
    expect(await lineCount(tenant.tenantId)).toBe(1);
  });
});
