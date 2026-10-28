import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  customsDeclarationLines,
  customsDeclarations,
  hsCodes,
  importRows,
} from "@/db/schema";
import type { ValidationContext } from "@/modules/catalog/validation";
import { CustomsError } from "./errors";
import type { CustomsLineImportData } from "./import-validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

export interface ApplyCustomsLineImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

export interface ApplyCustomsLineImportResult {
  readonly declarations: number;
  readonly written: number;
}

export async function loadCustomsImportContext(
  db: Database,
  tenantId: string,
): Promise<Partial<ValidationContext>> {
  const rows = await db
    .select({
      id: customsDeclarations.id,
      number: customsDeclarations.number,
      status: customsDeclarations.status,
    })
    .from(customsDeclarations)
    .where(eq(customsDeclarations.tenantId, tenantId));

  const lines = await db
    .select({
      declarationId: customsDeclarationLines.declarationId,
      hsCode: customsDeclarationLines.hsCode,
      designation: customsDeclarationLines.designation,
    })
    .from(customsDeclarationLines)
    .where(eq(customsDeclarationLines.tenantId, tenantId));

  const linesByDeclaration = new Map<string, { hsCodes: Set<string>; designations: Set<string> }>();
  for (const line of lines) {
    const entry = linesByDeclaration.get(line.declarationId) ?? {
      hsCodes: new Set<string>(),
      designations: new Set<string>(),
    };
    entry.hsCodes.add(line.hsCode);
    entry.designations.add(line.designation);
    linesByDeclaration.set(line.declarationId, entry);
  }

  return {
    customsDeclarationsByNumber: new Map(
      rows.map((row) => [row.number, { id: row.id, status: row.status }]),
    ),
    customsLinesByDeclaration: linesByDeclaration,
  };
}

export async function applyCustomsLineImport(
  tx: Transaction,
  input: ApplyCustomsLineImportInput,
): Promise<ApplyCustomsLineImportResult> {
  if (input.rows.length === 0) {
    throw new CustomsError("Aucune ligne de déclaration applicable dans cet import.");
  }

  const groups = new Map<string, StoredRow[]>();
  for (const row of input.rows) {
    const data = row.data as unknown as CustomsLineImportData;
    const group = groups.get(data.declarationId) ?? [];
    group.push(row);
    groups.set(data.declarationId, group);
  }

  const declarationIds = [...groups.keys()];
  if (declarationIds.some((id) => !id)) {
    throw new CustomsError("Ligne sans déclaration : relancez l'analyse avant de confirmer.");
  }

  const declarationRows = await tx
    .select({
      id: customsDeclarations.id,
      number: customsDeclarations.number,
      status: customsDeclarations.status,
    })
    .from(customsDeclarations)
    .where(
      and(
        eq(customsDeclarations.tenantId, input.tenantId),
        inArray(customsDeclarations.id, declarationIds),
      ),
    );
  const declarationsById = new Map(declarationRows.map((row) => [row.id, row]));

  const hsCodeIds = [
    ...new Set(input.rows.map((row) => (row.data as unknown as CustomsLineImportData).hsCodeId)),
  ];
  const hsRows = await tx
    .select({ id: hsCodes.id })
    .from(hsCodes)
    .where(and(eq(hsCodes.tenantId, input.tenantId), inArray(hsCodes.id, hsCodeIds)));
  const knownHsCodes = new Set(hsRows.map((row) => row.id));

  const nextLineNumbers = new Map<string, number>();
  for (const declarationId of declarationIds) {
    const [row] = await tx
      .select({
        maxLine: sql<number>`coalesce(max(${customsDeclarationLines.lineNumber}), 0)`,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.declarationId, declarationId),
        ),
      );
    nextLineNumbers.set(declarationId, Number(row?.maxLine ?? 0));
  }

  let written = 0;
  for (const [declarationId, rows] of groups) {
    const declaration = declarationsById.get(declarationId);
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable : relancez l'analyse avant de confirmer.");
    }
    if (declaration.status !== "draft") {
      throw new CustomsError(
        `La déclaration ${declaration.number} n'est plus en brouillon : relancez l'analyse.`,
      );
    }

    let lineNumber = nextLineNumbers.get(declarationId) ?? 0;
    const values = rows.map((row) => {
      const data = row.data as unknown as CustomsLineImportData;
      if (!knownHsCodes.has(data.hsCodeId)) {
        throw new CustomsError(
          `Ligne ${row.rowNumber} : code SH ${data.hsCode} introuvable. Relancez l'analyse.`,
        );
      }
      lineNumber += 1;
      return {
        tenantId: input.tenantId,
        declarationId,
        lineNumber,
        hsCodeId: data.hsCodeId,
        hsCode: data.hsCode,
        designation: data.designation,
        quantity: data.qty,
        unitCode: data.unitCode,
        valueXof: data.valueXof,
        weightKg: data.weightKg,
        originCountry: data.originCountry,
      };
    });

    await tx.insert(customsDeclarationLines).values(values);
    written += values.length;

    await tx
      .update(importRows)
      .set({ entityId: declarationId })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          inArray(
            importRows.rowNumber,
            rows.map((row) => row.rowNumber),
          ),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.declaration.import",
      entityType: "customs_declaration",
      entityId: declarationId,
      details: {
        source: "xlsx_import",
        batchId: input.batchId,
        number: declaration.number,
        lineCount: values.length,
      },
    });
  }

  return { declarations: groups.size, written };
}
