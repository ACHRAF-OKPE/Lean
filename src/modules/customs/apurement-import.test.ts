import { createHash } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, customsApurements, importRows } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCustomsTenant, type CustomsTenant } from "@/test/customs";
import { todayIsoDate } from "@/lib/dates";
import {
  CUSTOMS_APUREMENT_HEADERS,
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

async function seedIm9Declaration(
  tenant: CustomsTenant,
  options: {
    quantity?: string;
    regimeId?: string;
    date?: string;
    status?: "draft" | "liquidated";
  } = {},
): Promise<{ id: string; number: string; lineId: string }> {
  const created = await createDeclaration(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: {
      regimeId: options.regimeId ?? tenant.im9RegimeId,
      officeId: tenant.officeId,
      partnerId: tenant.partnerId,
      declarationDate: options.date ?? "2026-10-15",
      externalReference: "",
      freightAmountXof: 0,
      insuranceAmountXof: 0,
    },
  });
  const line = await addDeclarationLine(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    declarationId: created.id,
    raw: {
      hsCode: tenant.hsCode,
      designation: "Café vert au sommier",
      quantity: options.quantity ?? "10",
      unitCode: "KG",
      valueXof: 1_000_000,
      weightKg: "",
      originCountry: "CI",
    },
  });
  if (options.status !== "draft") {
    for (const transition of ["deposit", "liquidate"] as const) {
      await changeDeclarationStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        declarationId: created.id,
        transition,
      });
    }
  }
  return { id: created.id, number: created.number, lineId: line.id };
}

function apurementRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      numero_declaration: "DEC-2026-0001",
      ligne: "1",
      quantite: "4",
      date_apurement: todayIsoDate(),
      mode: "Production",
      reference: "PROD-2026-0142",
      ...overrides,
    },
  };
}

async function analyze(
  tenant: CustomsTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("apurements"),
) {
  return analyzeImport(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    kind: "customs_apurements",
    fileName: "apurements.xlsx",
    fileHash,
    sheetName: SHEET_DATA,
    rows,
    notes: [],
  });
}

async function entryCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(customsApurements)
    .where(eq(customsApurements.tenantId, tenantId));
  return row?.value ?? 0;
}

async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as LoadInput);
  return workbook;
}

describe("CUS-008 — modèle XLSX des apurements progressifs", () => {
  it("produit un modèle à six colonnes avec la liste des modes", async () => {
    expect([...CUSTOMS_APUREMENT_HEADERS]).toEqual([
      "numero_declaration",
      "ligne",
      "quantite",
      "date_apurement",
      "mode",
      "reference",
    ]);
    expect([...HEADERS_BY_KIND.customs_apurements]).toEqual([...CUSTOMS_APUREMENT_HEADERS]);

    const workbook = await loadWorkbook(await buildTemplate("customs_apurements"));
    const data = workbook.getWorksheet(SHEET_DATA);
    expect(data).toBeDefined();
    expect(workbook.getWorksheet(SHEET_HELP)).toBeDefined();
    expect(workbook.getWorksheet(SHEET_REFERENCES)).toBeDefined();

    const headers = CUSTOMS_APUREMENT_HEADERS.map(
      (_, index) => data?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...CUSTOMS_APUREMENT_HEADERS]);
    expect(data?.getColumn(1).numFmt).toBe("@");
    expect(data?.getColumn(2).numFmt).toBe("#,##0");
    expect(data?.getCell("E2").dataValidation.formulae).toEqual([
      '"Production,Exportation,Destruction,Transfert"',
    ]);
  });
});

describe("CUS-008 — analyse et application des apurements", () => {
  it("n'écrit rien à l'analyse puis ajoute les écritures au journal du sommier", async () => {
    const tenant = await seedCustomsTenant(db, "cus-008-apply");
    const declaration = await seedIm9Declaration(tenant, { quantity: "20" });

    const hash = hashOf("cus-008-apply");
    const rows = [
      apurementRow(2, { numero_declaration: declaration.number }),
      apurementRow(3, {
        numero_declaration: declaration.number,
        quantite: "6",
        mode: "Exportation",
        reference: "EXP-2026-0091",
      }),
    ];

    const analysis = await analyze(tenant, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(0);
    expect(analysis.notes.join(" ")).toContain("1 ligne de sommier recevra des écritures");
    expect(await entryCount(tenant.tenantId)).toBe(0);

    const applied = await applyImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
      actorUserId: tenant.userId,
    });
    expect(applied).toMatchObject({ kind: "customs_apurements", written: 2 });
    expect(await entryCount(tenant.tenantId)).toBe(2);

    const entries = await db
      .select({
        lineId: customsApurements.lineId,
        quantity: customsApurements.quantity,
        apuredAt: customsApurements.apuredAt,
        mode: customsApurements.mode,
        reference: customsApurements.reference,
      })
      .from(customsApurements)
      .where(eq(customsApurements.tenantId, tenant.tenantId))
      .orderBy(asc(customsApurements.createdAt));
    expect(entries.map((entry) => entry.quantity)).toEqual(["4.000000", "6.000000"]);
    expect(entries[0]).toMatchObject({
      lineId: declaration.lineId,
      apuredAt: todayIsoDate(),
      mode: "production",
      reference: "PROD-2026-0142",
    });
    expect(entries[1]).toMatchObject({ mode: "export", reference: "EXP-2026-0091" });

    const linked = await db
      .select({ entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(linked.map((row) => row.entityId)).toEqual([declaration.id, declaration.id]);

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "customs.apurement.import"),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(audits.every((audit) => (audit.details as { batchId?: string }).batchId)).toBe(true);

    const duplicate = await analyze(tenant, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: duplicate.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/déjà été importé en apurements progressifs/);
    expect(await entryCount(tenant.tenantId)).toBe(2);
  });

  it("refuse le dépassement du restant, les régimes non IM9 et les statuts non liquidés", async () => {
    const tenant = await seedCustomsTenant(db, "cus-008-errors");
    const im9 = await seedIm9Declaration(tenant);
    const plain = await seedIm9Declaration(tenant, { regimeId: tenant.plainRegimeId });
    const draft = await seedIm9Declaration(tenant, { status: "draft" });

    const rows = [
      apurementRow(2, { numero_declaration: im9.number, quantite: "4" }),
      apurementRow(3, { numero_declaration: im9.number, quantite: "7" }),
      apurementRow(4, { numero_declaration: plain.number }),
      apurementRow(5, { numero_declaration: draft.number }),
      apurementRow(6, { numero_declaration: im9.number, ligne: "9" }),
      apurementRow(7, { numero_declaration: im9.number, mode: "Vente" }),
      apurementRow(8, { numero_declaration: im9.number, reference: " " }),
    ];

    const analysis = await analyze(tenant, rows, hashOf("cus-008-errors"));
    expect(analysis.errorCount).toBe(6);

    const detail = await getImportBatch(db, {
      tenantId: tenant.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows.map((row) => row.status)).toEqual([
      "valid",
      "error",
      "error",
      "error",
      "error",
      "error",
      "error",
    ]);
    const messages = detail?.rows.flatMap((row) => row.errors).join(" ") ?? "";
    expect(messages).toContain("dépasse le restant de la ligne 1 (restant 6 KG, fichier inclus)");
    expect(messages).toContain("ne prévoit pas d'apurement progressif");
    expect(messages).toContain("l'apurement s'ouvre après la liquidation");
    expect(messages).toContain("Ligne 9 introuvable");
    expect(messages).toContain(
      "Mode d'apurement : production, exportation, destruction ou transfert attendu.",
    );
    expect(messages).toContain("Référence : obligatoire.");

    await expect(
      applyImportBatch(db, {
        tenantId: tenant.tenantId,
        batchId: analysis.batchId,
        actorUserId: tenant.userId,
      }),
    ).rejects.toThrow(/lignes sont en erreur/);
    expect(await entryCount(tenant.tenantId)).toBe(0);
  });
});
