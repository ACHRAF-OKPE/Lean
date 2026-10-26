import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  importRows,
  partners,
  salesOrderLines,
  salesOrders,
} from "@/db/schema";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { todayIsoDate } from "@/lib/dates";
import { computeLineTotal } from "@/modules/stock/quantities";
import { SalesError } from "./errors";
import { computeOrderDeliveryState } from "./lifecycle";
import type { SalesLineImportData } from "./import-validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface StoredRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

interface SalesGroup {
  readonly customerCode: string;
  readonly expectedDeliveryDate: string | null;
  readonly externalReference: string | null;
  readonly rows: StoredRow[];
}

export interface ApplySalesLinesInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredRow[];
}

export interface ApplySalesLinesResult {
  readonly orders: number;
  readonly written: number;
}

function groupRows(rows: readonly StoredRow[]): readonly SalesGroup[] {
  const groups = new Map<string, SalesGroup>();
  for (const row of rows) {
    const data = row.data as unknown as SalesLineImportData;
    const key = [
      data.customerCode,
      data.expectedDeliveryDate ?? "",
      data.externalReference ?? "",
    ].join("|");
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, {
        customerCode: data.customerCode,
        expectedDeliveryDate: data.expectedDeliveryDate,
        externalReference: data.externalReference,
        rows: [row],
      });
    }
  }
  return [...groups.values()];
}

export async function applySalesLines(
  tx: Transaction,
  input: ApplySalesLinesInput,
): Promise<ApplySalesLinesResult> {
  if (input.rows.length === 0) {
    throw new SalesError("Aucune ligne de vente applicable dans cet import.");
  }

  const groups = groupRows(input.rows);
  const customerCodes = [...new Set(groups.map((group) => group.customerCode))];
  const articleCodes = [
    ...new Set(input.rows.map((row) => (row.data as unknown as SalesLineImportData).articleCode)),
  ];

  const customerRows =
    customerCodes.length === 0
      ? []
      : await tx
          .select({
            id: partners.id,
            code: partners.code,
            name: partners.name,
            active: partners.active,
            isCustomer: partners.isCustomer,
          })
          .from(partners)
          .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.code, customerCodes)));
  const customersByCode = new Map(customerRows.map((row) => [row.code, row]));

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
            isSellable: articles.isSellable,
          })
          .from(articles)
          .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.code, articleCodes)));
  const articlesByCode = new Map(articleRows.map((row) => [row.code, row]));

  const orderDate = todayIsoDate();
  let createdOrders = 0;

  for (const group of groups) {
    const customer = customersByCode.get(group.customerCode);
    if (!customer) {
      throw new SalesError(
        `Client ${group.customerCode} introuvable : relancez l'analyse avant de confirmer.`,
      );
    }
    if (!customer.active || !customer.isCustomer) {
      throw new SalesError(
        `Le client ${group.customerCode} n'est plus actif ou n'a plus le rôle client : relancez l'analyse.`,
      );
    }

    const lines = group.rows.map((row) => {
      const data = row.data as unknown as SalesLineImportData;
      const article = articlesByCode.get(data.articleCode);
      if (!article) {
        throw new SalesError(
          `Ligne ${row.rowNumber} : article ${data.articleCode} introuvable. Relancez l'analyse.`,
        );
      }
      if (!article.active || !article.isSellable) {
        throw new SalesError(
          `Ligne ${row.rowNumber} : l'article ${data.articleCode} n'est plus actif ou vendable. Relancez l'analyse.`,
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
      throw new SalesError(
        `Le total de la commande ${group.customerCode} dépasse ${MAX_XOF_AMOUNT} XOF.`,
      );
    }

    const [order] = await tx
      .insert(salesOrders)
      .values({
        tenantId: input.tenantId,
        customerId: customer.id,
        status: "draft",
        deliveryState: computeOrderDeliveryState(
          lines.map((line) => ({
            type: line.article.type,
            deliveryState: "not_delivered" as const,
          })),
        ),
        invoicingState: "not_invoiced",
        orderDate,
        expectedDeliveryDate: group.expectedDeliveryDate,
        externalReference: group.externalReference,
        incoterm: null,
        notes: null,
        exTaxTotal,
        createdBy: input.actorUserId,
      })
      .returning({ id: salesOrders.id });

    if (!order) {
      throw new SalesError("La commande client importée n'a pas pu être créée.");
    }

    await tx.insert(salesOrderLines).values(
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
        deliveredQty: "0",
        invoicedQty: "0",
        deliveryState: "not_delivered" as const,
        invoicingState: "not_invoiced" as const,
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
      action: "sales.order.create",
      entityType: "sales_order",
      entityId: order.id,
      details: {
        source: "xlsx_import",
        batchId: input.batchId,
        customerCode: customer.code,
        lineCount: lines.length,
        exTaxTotal,
      },
    });

    createdOrders += 1;
  }

  return { orders: createdOrders, written: input.rows.length };
}
