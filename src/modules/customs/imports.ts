import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  customsApurements,
  customsDeclarationLines,
  customsDeclarations,
  customsRegimes,
  hsCodes,
  importRows,
} from "@/db/schema";
import type { ValidationContext } from "@/modules/catalog/validation";
import { microsToQuantity, quantityToMicros } from "@/modules/stock/quantities";
import { apurementContextError } from "./apurement";
import { CustomsError } from "./errors";
import type {
  CustomsApurementDeclarationReference,
  CustomsApurementImportData,
  CustomsApurementLineReference,
  CustomsLineImportData,
} from "./import-validation";

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
      requiresApurement: customsRegimes.requiresApurement,
    })
    .from(customsDeclarations)
    .innerJoin(
      customsRegimes,
      and(
        eq(customsRegimes.tenantId, customsDeclarations.tenantId),
        eq(customsRegimes.id, customsDeclarations.regimeId),
      ),
    )
    .where(eq(customsDeclarations.tenantId, tenantId));

  const lines = await db
    .select({
      id: customsDeclarationLines.id,
      declarationId: customsDeclarationLines.declarationId,
      lineNumber: customsDeclarationLines.lineNumber,
      quantity: customsDeclarationLines.quantity,
      unitCode: customsDeclarationLines.unitCode,
      hsCode: customsDeclarationLines.hsCode,
      designation: customsDeclarationLines.designation,
    })
    .from(customsDeclarationLines)
    .where(eq(customsDeclarationLines.tenantId, tenantId));

  const apurementSums = await db
    .select({
      declarationId: customsApurements.declarationId,
      lineId: customsApurements.lineId,
      quantity: sql<string>`sum(${customsApurements.quantity})`,
    })
    .from(customsApurements)
    .where(eq(customsApurements.tenantId, tenantId))
    .groupBy(customsApurements.declarationId, customsApurements.lineId);
  const apuredByLine = new Map(
    apurementSums.map((row) => [`${row.declarationId}:${row.lineId}`, row.quantity]),
  );

  const linesByDeclaration = new Map<string, { hsCodes: Set<string>; designations: Set<string> }>();
  const apurementLinesByDeclaration = new Map<string, Map<number, CustomsApurementLineReference>>();
  for (const line of lines) {
    const entry = linesByDeclaration.get(line.declarationId) ?? {
      hsCodes: new Set<string>(),
      designations: new Set<string>(),
    };
    entry.hsCodes.add(line.hsCode);
    entry.designations.add(line.designation);
    linesByDeclaration.set(line.declarationId, entry);

    const apurementLines = apurementLinesByDeclaration.get(line.declarationId) ?? new Map();
    apurementLines.set(line.lineNumber, {
      id: line.id,
      quantity: line.quantity,
      apuredQuantity: apuredByLine.get(`${line.declarationId}:${line.id}`) ?? "0",
      unitCode: line.unitCode,
    });
    apurementLinesByDeclaration.set(line.declarationId, apurementLines);
  }

  const apurementDeclarations = new Map<string, CustomsApurementDeclarationReference>();
  for (const row of rows) {
    apurementDeclarations.set(row.number, {
      id: row.id,
      status: row.status,
      requiresApurement: row.requiresApurement,
      lines: apurementLinesByDeclaration.get(row.id) ?? new Map(),
    });
  }

  return {
    customsDeclarationsByNumber: new Map(
      rows.map((row) => [row.number, { id: row.id, status: row.status }]),
    ),
    customsLinesByDeclaration: linesByDeclaration,
    customsApurementsByNumber: apurementDeclarations,
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

export interface ApplyCustomsApurementImportResult {
  readonly declarations: number;
  readonly written: number;
}

export async function applyCustomsApurementImport(
  tx: Transaction,
  input: ApplyCustomsLineImportInput,
): Promise<ApplyCustomsApurementImportResult> {
  if (input.rows.length === 0) {
    throw new CustomsError("Aucune écriture d'apurement applicable dans cet import.");
  }

  const rows = [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const declarationIds = [
    ...new Set(
      rows.map((row) => (row.data as unknown as CustomsApurementImportData).declarationId),
    ),
  ];
  if (declarationIds.some((id) => !id)) {
    throw new CustomsError("Écriture sans déclaration : relancez l'analyse avant de confirmer.");
  }

  const declarationRows = await tx
    .select({
      id: customsDeclarations.id,
      number: customsDeclarations.number,
      status: customsDeclarations.status,
      requiresApurement: customsRegimes.requiresApurement,
    })
    .from(customsDeclarations)
    .innerJoin(
      customsRegimes,
      and(
        eq(customsRegimes.tenantId, customsDeclarations.tenantId),
        eq(customsRegimes.id, customsDeclarations.regimeId),
      ),
    )
    .where(
      and(
        eq(customsDeclarations.tenantId, input.tenantId),
        inArray(customsDeclarations.id, declarationIds),
      ),
    )
    .for("update", { of: customsDeclarations });
  const declarationsById = new Map(declarationRows.map((row) => [row.id, row]));

  const lineRows = await tx
    .select({
      id: customsDeclarationLines.id,
      declarationId: customsDeclarationLines.declarationId,
      lineNumber: customsDeclarationLines.lineNumber,
      quantity: customsDeclarationLines.quantity,
      unitCode: customsDeclarationLines.unitCode,
    })
    .from(customsDeclarationLines)
    .where(
      and(
        eq(customsDeclarationLines.tenantId, input.tenantId),
        inArray(customsDeclarationLines.declarationId, declarationIds),
      ),
    );
  const linesByKey = new Map(
    lineRows.map((line) => [`${line.declarationId}:${line.lineNumber}`, line]),
  );

  const apurementSums = await tx
    .select({
      declarationId: customsApurements.declarationId,
      lineId: customsApurements.lineId,
      quantity: sql<string>`sum(${customsApurements.quantity})`,
    })
    .from(customsApurements)
    .where(
      and(
        eq(customsApurements.tenantId, input.tenantId),
        inArray(customsApurements.declarationId, declarationIds),
      ),
    )
    .groupBy(customsApurements.declarationId, customsApurements.lineId);
  const running = new Map<string, bigint>();
  for (const sum of apurementSums) {
    running.set(`${sum.declarationId}:${sum.lineId}`, quantityToMicros(sum.quantity));
  }

  const values: (typeof customsApurements.$inferInsert)[] = [];
  const auditValues: (typeof auditEvents.$inferInsert)[] = [];
  const rowsByDeclaration = new Map<string, number[]>();

  for (const row of rows) {
    const data = row.data as unknown as CustomsApurementImportData;
    const declaration = declarationsById.get(data.declarationId);
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable : relancez l'analyse avant de confirmer.");
    }
    if (!declaration.requiresApurement) {
      throw new CustomsError(
        `La déclaration ${declaration.number} n'accepte pas d'apurement progressif : relancez l'analyse.`,
      );
    }
    const line = linesByKey.get(`${declaration.id}:${data.lineNumber}`);
    if (!line) {
      throw new CustomsError(
        `Ligne ${data.lineNumber} introuvable sur ${declaration.number} : relancez l'analyse.`,
      );
    }
    const key = `${declaration.id}:${line.id}`;
    const base = running.get(key) ?? 0n;
    const error = apurementContextError({
      requiresApurement: true,
      status: declaration.status,
      lineQuantity: line.quantity,
      apuredQuantity: microsToQuantity(base),
      requestedQuantity: data.quantity,
      unitCode: line.unitCode,
    });
    if (error) {
      throw new CustomsError(`Ligne ${row.rowNumber} : ${error}`);
    }
    running.set(key, base + quantityToMicros(data.quantity));

    const entryId = randomUUID();
    values.push({
      id: entryId,
      tenantId: input.tenantId,
      declarationId: declaration.id,
      lineId: line.id,
      quantity: data.quantity,
      apuredAt: data.apuredDate,
      mode: data.mode,
      reference: data.reference,
      createdByUserId: input.actorUserId,
    });
    auditValues.push({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.apurement.import",
      entityType: "customs_apurement",
      entityId: entryId,
      details: {
        source: "xlsx_import",
        batchId: input.batchId,
        declarationId: declaration.id,
        declarationNumber: declaration.number,
        lineNumber: line.lineNumber,
        quantity: data.quantity,
        apuredAt: data.apuredDate,
        mode: data.mode,
        reference: data.reference,
      },
    });

    const numbers = rowsByDeclaration.get(declaration.id) ?? [];
    numbers.push(row.rowNumber);
    rowsByDeclaration.set(declaration.id, numbers);
  }

  await tx.insert(customsApurements).values(values);
  await tx.insert(auditEvents).values(auditValues);

  for (const [declarationId, rowNumbers] of rowsByDeclaration) {
    await tx
      .update(importRows)
      .set({ entityId: declarationId })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          inArray(importRows.rowNumber, rowNumbers),
        ),
      );
  }

  return { declarations: rowsByDeclaration.size, written: values.length };
}
