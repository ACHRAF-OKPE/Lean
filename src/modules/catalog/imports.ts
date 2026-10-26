import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  hsCodes,
  importBatches,
  importRows,
  partners,
  type ImportBatchStatus,
  type ImportKind,
  type ImportRowStatus,
} from "@/db/schema";
import { applyPurchaseLines } from "@/modules/purchases/imports";
import { PurchaseError } from "@/modules/purchases/errors";
import { applySalesLines } from "@/modules/sales/imports";
import { SalesError } from "@/modules/sales/errors";
import { CatalogError } from "./errors";
import { loadValidationContext } from "./queries";
import {
  validateImportRows,
  type ArticleImportData,
  type HsImportData,
  type PartnerImportData,
  type RawImportRow,
} from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AnalyzeImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly kind: ImportKind;
  readonly fileName: string;
  readonly fileHash: string;
  readonly sheetName: string;
  readonly rows: readonly RawImportRow[];
  readonly notes: readonly string[];
}

export interface AnalyzeImportResult {
  readonly batchId: string;
  readonly rowCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly notes: readonly string[];
}

export interface ImportBatchSummary {
  readonly id: string;
  readonly kind: ImportKind;
  readonly fileName: string;
  readonly status: ImportBatchStatus;
  readonly rowCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly createdAt: Date;
  readonly appliedAt: Date | null;
}

export interface ImportRowDetail {
  readonly id: string;
  readonly rowNumber: number;
  readonly status: ImportRowStatus;
  readonly code: string | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportBatchDetail {
  readonly batch: ImportBatchSummary & {
    readonly sheetName: string;
    readonly notes: readonly string[];
  };
  readonly rows: readonly ImportRowDetail[];
}

export interface ApplyImportResult {
  readonly kind: ImportKind;
  readonly written: number;
  readonly orders?: number;
}

const TABLE_BY_KIND: Record<"partners" | "articles" | "hs_codes", string> = {
  partners: "partners",
  articles: "articles",
  hs_codes: "hs_codes",
};

const appliedDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "Africa/Abidjan",
});

export async function analyzeImport(
  db: Database,
  input: AnalyzeImportInput,
): Promise<AnalyzeImportResult> {
  const context = await loadValidationContext(db, input.tenantId);
  const validation = validateImportRows(input.kind, input.rows, context);

  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: importBatches.id, appliedAt: importBatches.appliedAt })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.tenantId, input.tenantId),
          eq(importBatches.kind, input.kind),
          eq(importBatches.fileHash, input.fileHash),
          eq(importBatches.status, "applied"),
        ),
      )
      .orderBy(desc(importBatches.appliedAt))
      .limit(1);

    const notes = [...input.notes, ...(validation.notes ?? [])];
    if (previous?.appliedAt) {
      notes.push(
        `Un import identique a déjà été appliqué le ${appliedDateFormatter.format(previous.appliedAt)} : confirmer réappliquera les mêmes données.`,
      );
    }

    const [batch] = await tx
      .insert(importBatches)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        fileName: input.fileName,
        fileHash: input.fileHash,
        sheetName: input.sheetName,
        notes,
        status: "analyzed",
        rowCount: validation.rows.length,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        createdBy: input.actorUserId,
      })
      .returning({ id: importBatches.id });

    if (!batch) {
      throw new CatalogError("L'analyse n'a pas pu être enregistrée.");
    }

    await tx.insert(importRows).values(
      validation.rows.map((row) => ({
        tenantId: input.tenantId,
        batchId: batch.id,
        rowNumber: row.rowNumber,
        status: row.status,
        code: row.code,
        errors: row.errors,
        warnings: row.warnings,
        data: row.data,
      })),
    );

    return {
      batchId: batch.id,
      rowCount: validation.rows.length,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      notes,
    };
  });
}

export async function getImportBatch(
  db: Database,
  input: { tenantId: string; batchId: string },
): Promise<ImportBatchDetail | null> {
  const [batch] = await db
    .select({
      id: importBatches.id,
      kind: importBatches.kind,
      fileName: importBatches.fileName,
      sheetName: importBatches.sheetName,
      notes: importBatches.notes,
      status: importBatches.status,
      rowCount: importBatches.rowCount,
      errorCount: importBatches.errorCount,
      warningCount: importBatches.warningCount,
      createdAt: importBatches.createdAt,
      appliedAt: importBatches.appliedAt,
    })
    .from(importBatches)
    .where(and(eq(importBatches.tenantId, input.tenantId), eq(importBatches.id, input.batchId)))
    .limit(1);

  if (!batch) {
    return null;
  }

  const rows = await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      status: importRows.status,
      code: importRows.code,
      errors: importRows.errors,
      warnings: importRows.warnings,
    })
    .from(importRows)
    .where(and(eq(importRows.tenantId, input.tenantId), eq(importRows.batchId, input.batchId)))
    .orderBy(asc(importRows.rowNumber));

  return { batch, rows };
}

export async function listImportBatches(
  db: Database,
  input: { tenantId: string; kind?: ImportKind; limit?: number },
): Promise<readonly ImportBatchSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  return db
    .select({
      id: importBatches.id,
      kind: importBatches.kind,
      fileName: importBatches.fileName,
      status: importBatches.status,
      rowCount: importBatches.rowCount,
      errorCount: importBatches.errorCount,
      warningCount: importBatches.warningCount,
      createdAt: importBatches.createdAt,
      appliedAt: importBatches.appliedAt,
    })
    .from(importBatches)
    .where(
      input.kind
        ? and(eq(importBatches.tenantId, input.tenantId), eq(importBatches.kind, input.kind))
        : eq(importBatches.tenantId, input.tenantId),
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}

interface StoredImportRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

async function upsertPartners(
  tx: Transaction,
  tenantId: string,
  rows: readonly StoredImportRow[],
): Promise<void> {
  await tx
    .insert(partners)
    .values(
      rows.map((row) => {
        const data = row.data as unknown as PartnerImportData;
        return {
          tenantId,
          code: data.code,
          name: data.name,
          type: data.type,
          isCustomer: data.isCustomer,
          isSupplier: data.isSupplier,
          email: data.email,
          phone: data.phone,
          addressLine: data.addressLine,
          city: data.city,
          countryCode: data.countryCode,
          taxNumber: data.taxNumber,
          paymentTermDays: data.paymentTermDays,
          active: data.active,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [partners.tenantId, partners.code],
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        isCustomer: sql`excluded.is_customer`,
        isSupplier: sql`excluded.is_supplier`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        addressLine: sql`excluded.address_line`,
        city: sql`excluded.city`,
        countryCode: sql`excluded.country_code`,
        taxNumber: sql`excluded.tax_number`,
        paymentTermDays: sql`excluded.payment_term_days`,
        active: sql`excluded.active`,
        updatedAt: sql`now()`,
      },
    });
}

async function upsertArticles(
  tx: Transaction,
  tenantId: string,
  rows: readonly StoredImportRow[],
): Promise<void> {
  const hsRows = await tx
    .select({ id: hsCodes.id, code: hsCodes.code })
    .from(hsCodes)
    .where(eq(hsCodes.tenantId, tenantId));
  const hsByCode = new Map(hsRows.map((row) => [row.code, row.id]));

  await tx
    .insert(articles)
    .values(
      rows.map((row) => {
        const data = row.data as unknown as ArticleImportData;
        let hsCodeId: string | null = null;
        if (data.type === "product") {
          hsCodeId = data.hsCode ? (hsByCode.get(data.hsCode) ?? null) : null;
          if (!hsCodeId) {
            throw new CatalogError(
              `Code SH ${data.hsCode ?? "(vide)"} introuvable pour l'article ${data.code}. Relancez l'analyse.`,
            );
          }
        }
        return {
          tenantId,
          code: data.code,
          name: data.name,
          description: data.description,
          type: data.type,
          unitCode: data.unitCode,
          hsCodeId,
          salePriceXof: data.salePriceXof,
          purchasePriceXof: data.purchasePriceXof,
          isSellable: data.isSellable,
          isPurchasable: data.isPurchasable,
          countryOfOrigin: data.countryOfOrigin,
          active: data.active,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [articles.tenantId, articles.code],
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        type: sql`excluded.type`,
        unitCode: sql`excluded.unit_code`,
        hsCodeId: sql`excluded.hs_code_id`,
        salePriceXof: sql`excluded.sale_price_xof`,
        purchasePriceXof: sql`excluded.purchase_price_xof`,
        isSellable: sql`excluded.is_sellable`,
        isPurchasable: sql`excluded.is_purchasable`,
        countryOfOrigin: sql`excluded.country_of_origin`,
        active: sql`excluded.active`,
        updatedAt: sql`now()`,
      },
    });
}

async function upsertHsCodes(
  tx: Transaction,
  tenantId: string,
  rows: readonly StoredImportRow[],
): Promise<void> {
  await tx
    .insert(hsCodes)
    .values(
      rows.map((row) => {
        const data = row.data as unknown as HsImportData;
        return {
          tenantId,
          code: data.code,
          wording: data.wording,
          parentCode: data.parentCode,
          supplementaryUnit: data.supplementaryUnit,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [hsCodes.tenantId, hsCodes.code],
      set: {
        wording: sql`excluded.wording`,
        parentCode: sql`excluded.parent_code`,
        supplementaryUnit: sql`excluded.supplementary_unit`,
        updatedAt: sql`now()`,
      },
    });
}

export async function applyImportBatch(
  db: Database,
  input: { tenantId: string; batchId: string; actorUserId: string },
): Promise<ApplyImportResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select({
        id: importBatches.id,
        kind: importBatches.kind,
        fileName: importBatches.fileName,
        fileHash: importBatches.fileHash,
        status: importBatches.status,
        errorCount: importBatches.errorCount,
      })
      .from(importBatches)
      .where(and(eq(importBatches.tenantId, input.tenantId), eq(importBatches.id, input.batchId)))
      .limit(1)
      .for("update");

    if (!batch) {
      throw new CatalogError("Import introuvable dans cet espace de travail.");
    }
    if (batch.status === "applied") {
      throw new CatalogError("Cet import a déjà été appliqué.");
    }
    if (batch.errorCount > 0) {
      throw new CatalogError(
        "Des lignes sont en erreur : corrigez le fichier, relancez l'analyse puis confirmez.",
      );
    }

    if (batch.kind === "purchase_lines" || batch.kind === "sales_lines") {
      const [previous] = await tx
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.tenantId, input.tenantId),
            eq(importBatches.kind, batch.kind),
            eq(importBatches.fileHash, batch.fileHash),
            eq(importBatches.status, "applied"),
            ne(importBatches.id, batch.id),
          ),
        )
        .limit(1);
      if (previous) {
        const message =
          "Ce fichier a déjà été importé en commandes : un même fichier ne s'applique qu'une fois.";
        if (batch.kind === "purchase_lines") {
          throw new PurchaseError(message);
        }
        throw new SalesError(message);
      }
    }

    const rows = await tx
      .select({ rowNumber: importRows.rowNumber, data: importRows.data })
      .from(importRows)
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          ne(importRows.status, "error"),
        ),
      )
      .orderBy(asc(importRows.rowNumber));

    if (rows.length === 0) {
      throw new CatalogError("Aucune ligne applicable dans cet import.");
    }

    let orders: number | undefined;
    if (batch.kind === "purchase_lines") {
      const result = await applyPurchaseLines(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: batch.id,
        rows,
      });
      orders = result.orders;
    } else if (batch.kind === "sales_lines") {
      const result = await applySalesLines(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: batch.id,
        rows,
      });
      orders = result.orders;
    } else if (batch.kind === "partners") {
      await upsertPartners(tx, input.tenantId, rows);
    } else if (batch.kind === "articles") {
      await upsertArticles(tx, input.tenantId, rows);
    } else {
      await upsertHsCodes(tx, input.tenantId, rows);
    }

    if (batch.kind !== "purchase_lines" && batch.kind !== "sales_lines") {
      await tx.execute(sql`
        update ${importRows} as r
        set entity_id = c.id
        from ${sql.raw(`"${TABLE_BY_KIND[batch.kind]}"`)} as c
        where r.tenant_id = ${input.tenantId}
          and r.batch_id = ${input.batchId}
          and r.status <> 'error'
          and c.tenant_id = r.tenant_id
          and c.code = r.code
      `);
    }

    await tx
      .update(importBatches)
      .set({ status: "applied", appliedAt: sql`now()` })
      .where(and(eq(importBatches.tenantId, input.tenantId), eq(importBatches.id, input.batchId)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.import.apply",
      entityType: "import_batch",
      entityId: batch.id,
      details: { kind: batch.kind, fileName: batch.fileName, written: rows.length, orders },
    });

    return { kind: batch.kind, written: rows.length, orders };
  });
}
