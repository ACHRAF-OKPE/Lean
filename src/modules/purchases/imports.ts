import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  importRows,
  partners,
  purchaseOrderLines,
  purchaseOrders,
} from "@/db/schema";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { todayIsoDate } from "@/lib/dates";
import { computeOrderReceiptState } from "./lifecycle";
import { computeLineTotal } from "@/modules/stock/quantities";
import { PurchaseError } from "./errors";
import type { PurchaseLineImportData } from "./import-validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

interface PurchaseGroup {
  readonly supplierCode: string;
  readonly expectedReceiptDate: string | null;
  readonly externalReference: string | null;
  readonly rows: StoredRow[];
}

export interface ApplyPurchaseLinesInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

export interface ApplyPurchaseLinesResult {
  readonly orders: number;
  readonly written: number;
}

function groupRows(rows: readonly StoredRow[]): readonly PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();
  for (const row of rows) {
    const data = row.data as unknown as PurchaseLineImportData;
    const key = [
      data.supplierCode,
      data.expectedReceiptDate ?? "",
      data.externalReference ?? "",
    ].join("|");
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, {
        supplierCode: data.supplierCode,
        expectedReceiptDate: data.expectedReceiptDate,
        externalReference: data.externalReference,
        rows: [row],
      });
    }
  }
  return [...groups.values()];
}

export async function applyPurchaseLines(
  tx: Transaction,
  input: ApplyPurchaseLinesInput,
): Promise<ApplyPurchaseLinesResult> {
  if (input.rows.length === 0) {
    throw new PurchaseError("Aucune ligne de commande applicable dans cet import.");
  }

  const groups = groupRows(input.rows);
  const supplierCodes = [...new Set(groups.map((group) => group.supplierCode))];
  const articleCodes = [
    ...new Set(
      input.rows.map((row) => (row.data as unknown as PurchaseLineImportData).articleCode),
    ),
  ];

  const supplierRows =
    supplierCodes.length === 0
      ? []
      : await tx
          .select({
            id: partners.id,
            code: partners.code,
            name: partners.name,
            active: partners.active,
            isSupplier: partners.isSupplier,
          })
          .from(partners)
          .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.code, supplierCodes)));
  const suppliersByCode = new Map(supplierRows.map((row) => [row.code, row]));

  const articleRows =
    articleCodes.length === 0
      ? []
      : await tx
          .select({
            id: articles.id,
            code: articles.code,
            name: articles.name,
            type: articles.type,
            unitCode: articles.unitCode,
            active: articles.active,
            isPurchasable: articles.isPurchasable,
          })
          .from(articles)
          .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.code, articleCodes)));
  const articlesByCode = new Map(articleRows.map((row) => [row.code, row]));

  const orderDate = todayIsoDate();
  let createdOrders = 0;

  for (const group of groups) {
    const supplier = suppliersByCode.get(group.supplierCode);
    if (!supplier) {
      throw new PurchaseError(
        `Fournisseur ${group.supplierCode} introuvable : relancez l'analyse avant de confirmer.`,
      );
    }
    if (!supplier.active || !supplier.isSupplier) {
      throw new PurchaseError(
        `Le fournisseur ${group.supplierCode} n'est plus actif ou n'a plus le rôle fournisseur : relancez l'analyse.`,
      );
    }

    const lines = group.rows.map((row) => {
      const data = row.data as unknown as PurchaseLineImportData;
      const article = articlesByCode.get(data.articleCode);
      if (!article) {
        throw new PurchaseError(
          `Ligne ${row.rowNumber} : article ${data.articleCode} introuvable. Relancez l'analyse.`,
        );
      }
      if (!article.active || !article.isPurchasable) {
        throw new PurchaseError(
          `Ligne ${row.rowNumber} : l'article ${data.articleCode} n'est plus actif ou achetable. Relancez l'analyse.`,
        );
      }
      return {
        article,
        qty: data.qty,
        unitPriceXof: data.unitPriceXof,
        lineTotalXof: computeLineTotal(data.qty, data.unitPriceXof),
      };
    });

    const exTaxTotal = lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
    if (exTaxTotal > MAX_XOF_AMOUNT) {
      throw new PurchaseError(
        `Le total de la commande ${group.supplierCode} dépasse ${MAX_XOF_AMOUNT} XOF.`,
      );
    }

    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: input.tenantId,
        supplierId: supplier.id,
        status: "draft",
        receiptState: computeOrderReceiptState(
          lines.map((line) => ({
            type: line.article.type,
            receiptState: "not_received" as const,
          })),
        ),
        orderDate,
        expectedReceiptDate: group.expectedReceiptDate,
        externalReference: group.externalReference,
        exTaxTotal,
        createdBy: input.actorUserId,
      })
      .returning({ id: purchaseOrders.id });

    if (!order) {
      throw new PurchaseError("La commande importée n'a pas pu être créée.");
    }

    await tx.insert(purchaseOrderLines).values(
      lines.map((line, index) => ({
        tenantId: input.tenantId,
        orderId: order.id,
        lineNumber: index + 1,
        articleId: line.article.id,
        name: line.article.name,
        unitCode: line.article.unitCode,
        qty: line.qty,
        unitPriceXof: line.unitPriceXof,
        lineTotalXof: line.lineTotalXof,
        receivedQty: "0",
        receiptState: "not_received" as const,
      })),
    );

    await tx
      .update(importRows)
      .set({ entityId: order.id })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          inArray(
            importRows.rowNumber,
            group.rows.map((row) => row.rowNumber),
          ),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.order.create",
      entityType: "purchase_order",
      entityId: order.id,
      details: {
        source: "xlsx_import",
        batchId: input.batchId,
        supplierCode: supplier.code,
        lineCount: lines.length,
        exTaxTotal,
      },
    });

    createdOrders += 1;
  }

  return { orders: createdOrders, written: input.rows.length };
}
