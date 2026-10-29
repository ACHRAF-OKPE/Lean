import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articleSupplyPolicies,
  articles,
  auditEvents,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockLevels,
  stockLocations,
  supplyRunLines,
  supplyRuns,
  tenderInvitations,
  tenderRequestLines,
  tenderRequests,
  users,
  type SupplyDecision,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { computeOrderReceiptState } from "@/modules/purchases/lifecycle";
import { getSupplierOptions, type SupplierOption } from "@/modules/purchases/queries";
import { computeLineTotal, remainingQuantity } from "@/modules/stock/quantities";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { computeSupplyProposal, validateHorizon, type SupplyMovementEvent } from "./calculation";
import { SupplyError } from "./errors";
import {
  parseDismissReason,
  parseSupplyPolicy,
  validateSupplyPolicyTarget,
  type SupplyPolicyRaw,
} from "./policy";
import { groupSupplyLines, type SupplyGrouping } from "./proposals";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Transaction;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value: string | null | undefined): value is string {
  return Boolean(value && value.length <= 160 && EMAIL_PATTERN.test(value));
}

export interface SupplyPolicyRow {
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly purchasePriceXof: number;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly leadTimeDays: number;
  readonly safetyDelayDays: number;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly orderMultipleQty: string | null;
  readonly active: boolean;
  readonly updatedAt: Date | null;
}

export interface SupplyPoliciesPage {
  readonly rows: readonly SupplyPolicyRow[];
  readonly suppliers: readonly SupplierOption[];
}

export async function listSupplyPolicies(
  db: Database,
  tenantId: string,
): Promise<SupplyPoliciesPage> {
  const [rows, suppliers] = await Promise.all([
    db
      .select({
        articleId: articles.id,
        articleCode: articles.code,
        articleName: articles.name,
        unitCode: articles.unitCode,
        purchasePriceXof: articles.purchasePriceXof,
        supplierId: articleSupplyPolicies.supplierId,
        supplierName: partners.name,
        leadTimeDays: articleSupplyPolicies.leadTimeDays,
        safetyDelayDays: articleSupplyPolicies.safetyDelayDays,
        minStockQty: articleSupplyPolicies.minStockQty,
        reorderQty: articleSupplyPolicies.reorderQty,
        orderMultipleQty: articleSupplyPolicies.orderMultipleQty,
        active: articleSupplyPolicies.active,
        updatedAt: articleSupplyPolicies.updatedAt,
      })
      .from(articles)
      .leftJoin(
        articleSupplyPolicies,
        and(
          eq(articleSupplyPolicies.tenantId, articles.tenantId),
          eq(articleSupplyPolicies.articleId, articles.id),
        ),
      )
      .leftJoin(
        partners,
        and(
          eq(partners.tenantId, articleSupplyPolicies.tenantId),
          eq(partners.id, articleSupplyPolicies.supplierId),
        ),
      )
      .where(
        and(
          eq(articles.tenantId, tenantId),
          eq(articles.type, "product"),
          eq(articles.isPurchasable, true),
          eq(articles.active, true),
        ),
      )
      .orderBy(asc(articles.code))
      .limit(500),
    getSupplierOptions(db, tenantId),
  ]);

  return {
    rows: rows.map((row) => ({
      articleId: row.articleId,
      articleCode: row.articleCode,
      articleName: row.articleName,
      unitCode: row.unitCode,
      purchasePriceXof: row.purchasePriceXof,
      supplierId: row.supplierId ?? null,
      supplierName: row.supplierName ?? null,
      leadTimeDays: row.leadTimeDays ?? 0,
      safetyDelayDays: row.safetyDelayDays ?? 0,
      minStockQty: row.minStockQty ?? "0",
      reorderQty: row.reorderQty ?? "0",
      orderMultipleQty: row.orderMultipleQty ?? null,
      active: row.active ?? false,
      updatedAt: row.updatedAt ?? null,
    })),
    suppliers,
  };
}

export interface SaveSupplyPolicyInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly articleId: string;
  readonly data: SupplyPolicyRaw;
  readonly active: boolean;
}

export async function saveSupplyPolicy(
  db: Database,
  input: SaveSupplyPolicyInput,
): Promise<{ readonly articleId: string; readonly warnings: readonly string[] }> {
  const [article] = await db
    .select({
      id: articles.id,
      code: articles.code,
      type: articles.type,
      active: articles.active,
      isPurchasable: articles.isPurchasable,
    })
    .from(articles)
    .where(and(eq(articles.tenantId, input.tenantId), eq(articles.id, input.articleId)))
    .limit(1);

  const parsed = parseSupplyPolicy(input.data);
  const supplierId = parsed.values?.supplierId ?? "";
  const [supplier] = supplierId
    ? await db
        .select({
          code: partners.code,
          active: partners.active,
          isSupplier: partners.isSupplier,
        })
        .from(partners)
        .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, supplierId)))
        .limit(1)
    : [];

  const errors = [
    ...parsed.errors,
    ...validateSupplyPolicyTarget({
      article: article ?? null,
      supplier: supplier ?? null,
    }),
  ];
  if (errors.length > 0 || !parsed.values || !article || !supplier) {
    throw new SupplyError(
      errors.join("\n") || "La politique d'approvisionnement n'a pas pu être validée.",
    );
  }
  const policy = parsed.values;

  await db.transaction(async (tx) => {
    await tx
      .insert(articleSupplyPolicies)
      .values({
        tenantId: input.tenantId,
        articleId: input.articleId,
        supplierId: policy.supplierId,
        leadTimeDays: policy.leadTimeDays,
        safetyDelayDays: policy.safetyDelayDays,
        minStockQty: policy.minStockQty,
        reorderQty: policy.reorderQty,
        orderMultipleQty: policy.orderMultipleQty,
        active: input.active,
        updatedBy: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: [articleSupplyPolicies.tenantId, articleSupplyPolicies.articleId],
        set: {
          supplierId: policy.supplierId,
          leadTimeDays: policy.leadTimeDays,
          safetyDelayDays: policy.safetyDelayDays,
          minStockQty: policy.minStockQty,
          reorderQty: policy.reorderQty,
          orderMultipleQty: policy.orderMultipleQty,
          active: input.active,
          updatedBy: input.actorUserId,
          updatedAt: new Date(),
        },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "supply.policy.save",
      entityType: "article",
      entityId: input.articleId,
      details: {
        articleCode: article.code,
        supplierCode: supplier.code,
        leadTimeDays: policy.leadTimeDays,
        safetyDelayDays: policy.safetyDelayDays,
        minStockQty: policy.minStockQty,
        reorderQty: policy.reorderQty,
        orderMultipleQty: policy.orderMultipleQty,
        active: input.active,
      },
    });
  });

  return { articleId: input.articleId, warnings: parsed.warnings };
}

interface EligiblePolicy {
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly unitCode: string;
  readonly purchasePriceXof: number;
  readonly supplierId: string;
  readonly leadTimeDays: number;
  readonly safetyDelayDays: number;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly orderMultipleQty: string | null;
}

async function loadEligiblePolicies(db: DbLike, tenantId: string): Promise<EligiblePolicy[]> {
  return db
    .select({
      articleId: articles.id,
      articleCode: articles.code,
      articleName: articles.name,
      unitCode: articles.unitCode,
      purchasePriceXof: articles.purchasePriceXof,
      supplierId: articleSupplyPolicies.supplierId,
      leadTimeDays: articleSupplyPolicies.leadTimeDays,
      safetyDelayDays: articleSupplyPolicies.safetyDelayDays,
      minStockQty: articleSupplyPolicies.minStockQty,
      reorderQty: articleSupplyPolicies.reorderQty,
      orderMultipleQty: articleSupplyPolicies.orderMultipleQty,
    })
    .from(articleSupplyPolicies)
    .innerJoin(
      articles,
      and(
        eq(articles.tenantId, articleSupplyPolicies.tenantId),
        eq(articles.id, articleSupplyPolicies.articleId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, articleSupplyPolicies.tenantId),
        eq(partners.id, articleSupplyPolicies.supplierId),
      ),
    )
    .where(
      and(
        eq(articleSupplyPolicies.tenantId, tenantId),
        eq(articleSupplyPolicies.active, true),
        eq(articles.active, true),
        eq(articles.type, "product"),
        eq(articles.isPurchasable, true),
        eq(partners.active, true),
        eq(partners.isSupplier, true),
      ),
    )
    .orderBy(asc(articles.code));
}

async function loadStockByArticle(
  db: DbLike,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, string>> {
  if (articleIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      articleId: stockLevels.articleId,
      qty: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)::text`,
    })
    .from(stockLevels)
    .innerJoin(
      stockLocations,
      and(
        eq(stockLocations.tenantId, stockLevels.tenantId),
        eq(stockLocations.id, stockLevels.locationId),
      ),
    )
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLocations.type, "internal"),
        inArray(stockLevels.articleId, [...articleIds]),
      ),
    )
    .groupBy(stockLevels.articleId);

  return new Map(rows.map((row) => [row.articleId, row.qty]));
}

async function loadIncomingEvents(
  db: DbLike,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, SupplyMovementEvent[]>> {
  const events = new Map<string, SupplyMovementEvent[]>();
  if (articleIds.length === 0) {
    return events;
  }
  const rows = await db
    .select({
      articleId: purchaseOrderLines.articleId,
      qty: purchaseOrderLines.qty,
      receivedQty: purchaseOrderLines.receivedQty,
      expectedDate: purchaseOrders.expectedReceiptDate,
    })
    .from(purchaseOrderLines)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.tenantId, purchaseOrderLines.tenantId),
        eq(purchaseOrders.id, purchaseOrderLines.orderId),
      ),
    )
    .where(
      and(
        eq(purchaseOrderLines.tenantId, tenantId),
        eq(purchaseOrders.status, "confirmed"),
        ne(purchaseOrderLines.receiptState, "received"),
        inArray(purchaseOrderLines.articleId, [...articleIds]),
      ),
    );

  for (const row of rows) {
    const remaining = remainingQuantity(row.qty, row.receivedQty);
    const list = events.get(row.articleId) ?? [];
    list.push({ date: row.expectedDate ?? null, direction: "in", qty: remaining });
    events.set(row.articleId, list);
  }
  return events;
}

async function loadOutgoingEvents(
  db: DbLike,
  tenantId: string,
  articleIds: readonly string[],
): Promise<Map<string, SupplyMovementEvent[]>> {
  const events = new Map<string, SupplyMovementEvent[]>();
  if (articleIds.length === 0) {
    return events;
  }
  const rows = await db
    .select({
      articleId: salesOrderLines.articleId,
      qty: salesOrderLines.qty,
      deliveredQty: salesOrderLines.deliveredQty,
      expectedDate: salesOrders.expectedDeliveryDate,
    })
    .from(salesOrderLines)
    .innerJoin(
      salesOrders,
      and(
        eq(salesOrders.tenantId, salesOrderLines.tenantId),
        eq(salesOrders.id, salesOrderLines.orderId),
      ),
    )
    .where(
      and(
        eq(salesOrderLines.tenantId, tenantId),
        eq(salesOrders.status, "confirmed"),
        ne(salesOrderLines.deliveryState, "delivered"),
        inArray(salesOrderLines.articleId, [...articleIds]),
      ),
    );

  for (const row of rows) {
    const remaining = remainingQuantity(row.qty, row.deliveredQty);
    const list = events.get(row.articleId) ?? [];
    list.push({ date: row.expectedDate ?? null, direction: "out", qty: remaining });
    events.set(row.articleId, list);
  }
  return events;
}

export interface SupplyRunLineInput {
  readonly articleId: string;
  readonly supplierId: string;
  readonly unitCode: string;
  readonly lineNumber: number;
  readonly stockQty: string;
  readonly incomingQty: string;
  readonly outgoingQty: string;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly projectedQty: string;
  readonly proposedQty: string;
  readonly purchasePriceXof: number;
  readonly needDate: string;
  readonly orderDate: string;
  readonly late: boolean;
}

export interface SupplyRunResult {
  readonly id: string;
  readonly number: string;
  readonly lineCount: number;
  readonly proposalCount: number;
}

export async function runSupplyCalculation(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    horizonDays: unknown;
    today?: string;
  },
): Promise<SupplyRunResult> {
  const horizonDays = validateHorizon(input.horizonDays);
  if (horizonDays === null) {
    throw new SupplyError("Horizon : nombre entier de jours entre 1 et 365 attendu.");
  }
  const today = input.today ?? todayIsoDate();

  const policies = await loadEligiblePolicies(db, input.tenantId);
  const articleIds = policies.map((policy) => policy.articleId);
  const [stockByArticle, incomingByArticle, outgoingByArticle] = await Promise.all([
    loadStockByArticle(db, input.tenantId, articleIds),
    loadIncomingEvents(db, input.tenantId, articleIds),
    loadOutgoingEvents(db, input.tenantId, articleIds),
  ]);

  const lines: SupplyRunLineInput[] = [];
  for (const policy of policies) {
    const proposal = computeSupplyProposal({
      today,
      horizonDays,
      stockQty: stockByArticle.get(policy.articleId) ?? "0",
      minStockQty: policy.minStockQty,
      reorderQty: policy.reorderQty,
      orderMultipleQty: policy.orderMultipleQty,
      leadTimeDays: policy.leadTimeDays,
      safetyDelayDays: policy.safetyDelayDays,
      events: [
        ...(incomingByArticle.get(policy.articleId) ?? []),
        ...(outgoingByArticle.get(policy.articleId) ?? []),
      ],
    });
    if (!proposal) {
      continue;
    }
    lines.push({
      articleId: policy.articleId,
      supplierId: policy.supplierId,
      unitCode: policy.unitCode,
      lineNumber: 0,
      stockQty: stockByArticle.get(policy.articleId) ?? "0",
      incomingQty: proposal.incomingQty,
      outgoingQty: proposal.outgoingQty,
      minStockQty: policy.minStockQty,
      reorderQty: policy.reorderQty,
      projectedQty: proposal.projectedQty,
      proposedQty: proposal.proposedQty,
      purchasePriceXof: policy.purchasePriceXof,
      needDate: proposal.needDate,
      orderDate: proposal.orderDate,
      late: proposal.late,
    });
  }

  lines.sort((left, right) => {
    const byDate = left.needDate.localeCompare(right.needDate);
    return byDate !== 0 ? byDate : left.articleId.localeCompare(right.articleId);
  });

  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "supply_run",
      date: today,
    });
    const [run] = await tx
      .insert(supplyRuns)
      .values({
        tenantId: input.tenantId,
        number,
        horizonDays,
        lineCount: policies.length,
        proposalCount: lines.length,
        calculatedBy: input.actorUserId,
      })
      .returning({ id: supplyRuns.id });
    if (!run) {
      throw new SupplyError("Le calcul des besoins n'a pas pu être enregistré.");
    }

    if (lines.length > 0) {
      await tx.insert(supplyRunLines).values(
        lines.map((line, index) => ({
          tenantId: input.tenantId,
          runId: run.id,
          lineNumber: index + 1,
          articleId: line.articleId,
          supplierId: line.supplierId,
          unitCode: line.unitCode,
          stockQty: line.stockQty,
          incomingQty: line.incomingQty,
          outgoingQty: line.outgoingQty,
          minStockQty: line.minStockQty,
          reorderQty: line.reorderQty,
          projectedQty: line.projectedQty,
          proposedQty: line.proposedQty,
          purchasePriceXof: line.purchasePriceXof,
          needDate: line.needDate,
          orderDate: line.orderDate,
          late: line.late,
          decision: "pending" as const,
        })),
      );
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "supply.run.calculate",
      entityType: "supply_run",
      entityId: run.id,
      details: {
        number,
        horizonDays,
        lineCount: policies.length,
        proposalCount: lines.length,
      },
    });

    return { id: run.id, number, lineCount: policies.length, proposalCount: lines.length };
  });
}

export interface SupplyStats {
  readonly pendingProposals: number;
  readonly lastRunNumber: string | null;
}

export async function getSupplyStats(db: Database, tenantId: string): Promise<SupplyStats> {
  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supplyRunLines)
    .where(and(eq(supplyRunLines.tenantId, tenantId), eq(supplyRunLines.decision, "pending")));
  const [last] = await db
    .select({ number: supplyRuns.number })
    .from(supplyRuns)
    .where(eq(supplyRuns.tenantId, tenantId))
    .orderBy(desc(supplyRuns.calculatedAt))
    .limit(1);

  return {
    pendingProposals: Number(pending?.count ?? 0),
    lastRunNumber: last?.number ?? null,
  };
}

export interface SupplyRunSummary {
  readonly id: string;
  readonly number: string;
  readonly horizonDays: number;
  readonly lineCount: number;
  readonly proposalCount: number;
  readonly pendingCount: number;
  readonly calculatedAt: Date;
  readonly calculatedByName: string | null;
}

export async function listSupplyRuns(
  db: Database,
  tenantId: string,
): Promise<readonly SupplyRunSummary[]> {
  const rows = await db
    .select({
      id: supplyRuns.id,
      number: supplyRuns.number,
      horizonDays: supplyRuns.horizonDays,
      lineCount: supplyRuns.lineCount,
      proposalCount: supplyRuns.proposalCount,
      calculatedAt: supplyRuns.calculatedAt,
      calculatedByName: users.name,
      pendingCount: sql<number>`(
        select count(*)::int from ${supplyRunLines}
        where ${supplyRunLines.tenantId} = ${supplyRuns.tenantId}
          and ${supplyRunLines.runId} = ${supplyRuns.id}
          and ${supplyRunLines.decision} = 'pending'
      )`,
    })
    .from(supplyRuns)
    .leftJoin(users, eq(users.id, supplyRuns.calculatedBy))
    .where(eq(supplyRuns.tenantId, tenantId))
    .orderBy(desc(supplyRuns.calculatedAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    pendingCount: Number(row.pendingCount ?? 0),
  }));
}

export interface SupplyRunLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly articleId: string;
  readonly articleCode: string;
  readonly articleName: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly unitCode: string;
  readonly stockQty: string;
  readonly incomingQty: string;
  readonly outgoingQty: string;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly projectedQty: string;
  readonly proposedQty: string;
  readonly purchasePriceXof: number;
  readonly needDate: string;
  readonly orderDate: string;
  readonly late: boolean;
  readonly decision: SupplyDecision;
  readonly decisionReason: string | null;
  readonly convertedDocumentId: string | null;
}

export interface SupplyRunDetail {
  readonly run: SupplyRunSummary;
  readonly lines: readonly SupplyRunLineDetail[];
}

export async function getSupplyRun(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<SupplyRunDetail | null> {
  const [runRow] = await db
    .select({
      id: supplyRuns.id,
      number: supplyRuns.number,
      horizonDays: supplyRuns.horizonDays,
      lineCount: supplyRuns.lineCount,
      proposalCount: supplyRuns.proposalCount,
      calculatedAt: supplyRuns.calculatedAt,
      calculatedByName: users.name,
    })
    .from(supplyRuns)
    .leftJoin(users, eq(users.id, supplyRuns.calculatedBy))
    .where(and(eq(supplyRuns.tenantId, tenantId), eq(supplyRuns.id, runId)))
    .limit(1);

  if (!runRow) {
    return null;
  }

  const lineRows = await db
    .select({
      id: supplyRunLines.id,
      lineNumber: supplyRunLines.lineNumber,
      articleId: supplyRunLines.articleId,
      articleCode: articles.code,
      articleName: articles.name,
      supplierId: supplyRunLines.supplierId,
      supplierCode: partners.code,
      supplierName: partners.name,
      unitCode: supplyRunLines.unitCode,
      stockQty: supplyRunLines.stockQty,
      incomingQty: supplyRunLines.incomingQty,
      outgoingQty: supplyRunLines.outgoingQty,
      minStockQty: supplyRunLines.minStockQty,
      reorderQty: supplyRunLines.reorderQty,
      projectedQty: supplyRunLines.projectedQty,
      proposedQty: supplyRunLines.proposedQty,
      purchasePriceXof: supplyRunLines.purchasePriceXof,
      needDate: supplyRunLines.needDate,
      orderDate: supplyRunLines.orderDate,
      late: supplyRunLines.late,
      decision: supplyRunLines.decision,
      decisionReason: supplyRunLines.decisionReason,
      convertedDocumentId: supplyRunLines.convertedDocumentId,
    })
    .from(supplyRunLines)
    .innerJoin(
      articles,
      and(
        eq(articles.tenantId, supplyRunLines.tenantId),
        eq(articles.id, supplyRunLines.articleId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, supplyRunLines.tenantId),
        eq(partners.id, supplyRunLines.supplierId),
      ),
    )
    .where(and(eq(supplyRunLines.tenantId, tenantId), eq(supplyRunLines.runId, runId)))
    .orderBy(asc(supplyRunLines.lineNumber));

  const pendingCount = lineRows.filter((line) => line.decision === "pending").length;

  return {
    run: { ...runRow, pendingCount },
    lines: lineRows,
  };
}

async function loadPendingLines(
  tx: Transaction,
  tenantId: string,
  runId: string,
  lineIds: readonly string[],
) {
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) {
    throw new SupplyError("Sélectionnez au moins une proposition.");
  }
  const [run] = await tx
    .select({ id: supplyRuns.id, number: supplyRuns.number })
    .from(supplyRuns)
    .where(and(eq(supplyRuns.tenantId, tenantId), eq(supplyRuns.id, runId)))
    .limit(1)
    .for("update");
  if (!run) {
    throw new SupplyError("Calcul des besoins introuvable dans cet espace de travail.");
  }

  const lines = await tx
    .select({
      id: supplyRunLines.id,
      lineNumber: supplyRunLines.lineNumber,
      articleId: supplyRunLines.articleId,
      supplierId: supplyRunLines.supplierId,
      unitCode: supplyRunLines.unitCode,
      proposedQty: supplyRunLines.proposedQty,
      purchasePriceXof: supplyRunLines.purchasePriceXof,
      needDate: supplyRunLines.needDate,
      decision: supplyRunLines.decision,
    })
    .from(supplyRunLines)
    .where(
      and(
        eq(supplyRunLines.tenantId, tenantId),
        eq(supplyRunLines.runId, runId),
        inArray(supplyRunLines.id, ids),
      ),
    )
    .orderBy(asc(supplyRunLines.lineNumber));

  if (lines.length !== ids.length) {
    throw new SupplyError("Une proposition sélectionnée est introuvable dans ce calcul.");
  }
  for (const line of lines) {
    if (line.decision !== "pending") {
      throw new SupplyError(
        `Proposition ${line.lineNumber} : déjà traitée, elle ne peut plus être convertie.`,
      );
    }
  }

  return { run, lines };
}

export interface GenerateSupplyOrdersInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly runId: string;
  readonly lineIds: readonly string[];
  readonly grouping: SupplyGrouping;
  readonly today?: string;
}

export interface GenerateSupplyOrdersResult {
  readonly orderIds: readonly string[];
}

export async function generateSupplyPurchaseOrders(
  db: Database,
  input: GenerateSupplyOrdersInput,
): Promise<GenerateSupplyOrdersResult> {
  const today = input.today ?? todayIsoDate();

  return db.transaction(async (tx) => {
    const { run, lines } = await loadPendingLines(tx, input.tenantId, input.runId, input.lineIds);
    const articleIds = [...new Set(lines.map((line) => line.articleId))];
    const articleRows = await tx
      .select({
        id: articles.id,
        code: articles.code,
        name: articles.name,
        type: articles.type,
        active: articles.active,
        isPurchasable: articles.isPurchasable,
      })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.id, articleIds)));
    const articlesById = new Map(articleRows.map((row) => [row.id, row]));

    const supplierIds = [...new Set(lines.map((line) => line.supplierId))];
    const supplierRows = await tx
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        active: partners.active,
        isSupplier: partners.isSupplier,
      })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, supplierIds)));
    const suppliersById = new Map(supplierRows.map((row) => [row.id, row]));

    for (const line of lines) {
      const article = articlesById.get(line.articleId);
      if (!article || article.type !== "product" || !article.active || !article.isPurchasable) {
        throw new SupplyError(
          `Proposition ${line.lineNumber} : l'article n'est plus actif et achetable.`,
        );
      }
      const supplier = suppliersById.get(line.supplierId);
      if (!supplier || !supplier.active || !supplier.isSupplier) {
        throw new SupplyError(
          `Proposition ${line.lineNumber} : le fournisseur n'est plus actif ou n'a plus le rôle fournisseur.`,
        );
      }
    }

    const groups = groupSupplyLines(lines, input.grouping);
    const orderIds: string[] = [];

    for (const group of groups) {
      const supplier = suppliersById.get(group.supplierId);
      if (!supplier) {
        throw new SupplyError("Fournisseur introuvable dans cet espace de travail.");
      }
      const values = group.lines.map((line, index) => {
        const article = articlesById.get(line.articleId);
        if (!article) {
          throw new SupplyError(`Proposition ${line.lineNumber} : article introuvable.`);
        }
        const lineTotalXof = computeLineTotal(line.proposedQty, line.purchasePriceXof);
        if (lineTotalXof > 2_000_000_000) {
          throw new SupplyError(
            `Proposition ${line.lineNumber} : total de ligne supérieur au plafond de 2 000 000 000 XOF.`,
          );
        }
        return {
          lineNumber: index + 1,
          articleId: line.articleId,
          name: article.name,
          unitCode: line.unitCode,
          qty: line.proposedQty,
          unitPriceXof: line.purchasePriceXof,
          lineTotalXof,
        };
      });
      const exTaxTotal = values.reduce((sum, line) => sum + line.lineTotalXof, 0);
      if (exTaxTotal > 2_000_000_000) {
        throw new SupplyError(
          `Commande ${supplier.code} : total supérieur au plafond de 2 000 000 000 XOF.`,
        );
      }

      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: input.tenantId,
          supplierId: group.supplierId,
          supplyRunId: run.id,
          status: "draft",
          receiptState: computeOrderReceiptState(
            values.map(() => ({ type: "product" as const, receiptState: "not_received" as const })),
          ),
          orderDate: today,
          expectedReceiptDate: group.needDate,
          externalReference: run.number,
          notes: null,
          exTaxTotal,
          createdBy: input.actorUserId,
        })
        .returning({ id: purchaseOrders.id });
      if (!order) {
        throw new SupplyError("La commande fournisseur n'a pas pu être créée.");
      }

      await tx.insert(purchaseOrderLines).values(
        values.map((line) => ({
          tenantId: input.tenantId,
          orderId: order.id,
          lineNumber: line.lineNumber,
          articleId: line.articleId,
          name: line.name,
          unitCode: line.unitCode,
          qty: line.qty,
          unitPriceXof: line.unitPriceXof,
          lineTotalXof: line.lineTotalXof,
          receivedQty: "0",
          receiptState: "not_received" as const,
        })),
      );

      await tx
        .update(supplyRunLines)
        .set({
          decision: "ordered",
          convertedDocumentId: order.id,
          decidedBy: input.actorUserId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(supplyRunLines.tenantId, input.tenantId),
            inArray(
              supplyRunLines.id,
              group.lines.map((line) => line.id),
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
          supplierCode: supplier.code,
          lineCount: values.length,
          exTaxTotal,
          supplyRun: run.number,
        },
      });

      orderIds.push(order.id);
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "supply.orders.create",
      entityType: "supply_run",
      entityId: run.id,
      details: {
        runNumber: run.number,
        orderCount: orderIds.length,
        lineCount: lines.length,
        grouping: input.grouping,
      },
    });

    return { orderIds };
  });
}

export interface GenerateSupplyTenderInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly runId: string;
  readonly lineIds: readonly string[];
  readonly deadline: unknown;
  readonly today?: string;
}

export async function generateSupplyTender(
  db: Database,
  input: GenerateSupplyTenderInput,
): Promise<{ readonly id: string }> {
  const today = input.today ?? todayIsoDate();
  const deadline = typeof input.deadline === "string" ? input.deadline.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline < today) {
    throw new SupplyError("Échéance : date du jour ou future attendue.");
  }

  return db.transaction(async (tx) => {
    const { run, lines } = await loadPendingLines(tx, input.tenantId, input.runId, input.lineIds);

    const articleIds = [...new Set(lines.map((line) => line.articleId))];
    const articleRows = await tx
      .select({
        id: articles.id,
        name: articles.name,
        type: articles.type,
        active: articles.active,
        isPurchasable: articles.isPurchasable,
      })
      .from(articles)
      .where(and(eq(articles.tenantId, input.tenantId), inArray(articles.id, articleIds)));
    const articlesById = new Map(articleRows.map((row) => [row.id, row]));

    const supplierIds = [...new Set(lines.map((line) => line.supplierId))];
    const supplierRows = await tx
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        email: partners.email,
        active: partners.active,
        isSupplier: partners.isSupplier,
      })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), inArray(partners.id, supplierIds)));
    const suppliersById = new Map(supplierRows.map((row) => [row.id, row]));

    const invited: { supplierId: string; name: string; email: string }[] = [];
    for (const supplierId of supplierIds) {
      const supplier = suppliersById.get(supplierId);
      if (!supplier || !supplier.active || !supplier.isSupplier) {
        throw new SupplyError(
          "Un fournisseur de la sélection n'est plus actif ou n'a plus le rôle fournisseur.",
        );
      }
      if (!isEmail(supplier.email)) {
        throw new SupplyError(
          `Le fournisseur ${supplier.code} n'a pas d'adresse e-mail valide : la demande de cotation ne peut pas être créée.`,
        );
      }
      invited.push({ supplierId, name: supplier.name, email: supplier.email });
    }

    for (const line of lines) {
      const article = articlesById.get(line.articleId);
      if (!article || article.type !== "product" || !article.active || !article.isPurchasable) {
        throw new SupplyError(
          `Proposition ${line.lineNumber} : l'article n'est plus actif et achetable.`,
        );
      }
    }

    const title = `Réapprovisionnement ${run.number}`;
    const [tender] = await tx
      .insert(tenderRequests)
      .values({
        tenantId: input.tenantId,
        title,
        notes: `Généré depuis le calcul des besoins ${run.number}.`,
        deadline,
        supplyRunId: run.id,
        status: "draft",
        createdBy: input.actorUserId,
      })
      .returning({ id: tenderRequests.id });
    if (!tender) {
      throw new SupplyError("La demande de cotation n'a pas pu être créée.");
    }

    await tx.insert(tenderRequestLines).values(
      lines.map((line, index) => ({
        tenantId: input.tenantId,
        tenderId: tender.id,
        lineNumber: index + 1,
        articleId: line.articleId,
        name: articlesById.get(line.articleId)?.name ?? "",
        unitCode: line.unitCode,
        qty: line.proposedQty,
        requestedDate: line.needDate,
        note: null,
      })),
    );

    await tx.insert(tenderInvitations).values(
      invited.map((supplier) => ({
        tenantId: input.tenantId,
        tenderId: tender.id,
        supplierId: supplier.supplierId,
        recipientEmail: supplier.email,
        recipientName: supplier.name,
        status: "pending" as const,
      })),
    );

    await tx
      .update(supplyRunLines)
      .set({
        decision: "tendered",
        convertedDocumentId: tender.id,
        decidedBy: input.actorUserId,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(supplyRunLines.tenantId, input.tenantId),
          inArray(
            supplyRunLines.id,
            lines.map((line) => line.id),
          ),
        ),
      );

    await tx.insert(auditEvents).values([
      {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "tender.create",
        entityType: "tender_request",
        entityId: tender.id,
        details: {
          title,
          deadline,
          lineCount: lines.length,
          supplierCount: invited.length,
          source: "supply_run",
          supplyRun: run.number,
        },
      },
      {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "supply.tender.create",
        entityType: "tender_request",
        entityId: tender.id,
        details: {
          runNumber: run.number,
          lineCount: lines.length,
          supplierCount: invited.length,
        },
      },
    ]);

    return { id: tender.id };
  });
}

export async function dismissSupplyLine(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    runId: string;
    lineId: string;
    reason: unknown;
  },
): Promise<{ readonly lineId: string }> {
  const parsed = parseDismissReason(input.reason);
  if (!parsed.reason) {
    throw new SupplyError(parsed.error ?? "Motif obligatoire.");
  }

  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: supplyRunLines.id,
        lineNumber: supplyRunLines.lineNumber,
        runId: supplyRunLines.runId,
        decision: supplyRunLines.decision,
      })
      .from(supplyRunLines)
      .where(
        and(
          eq(supplyRunLines.tenantId, input.tenantId),
          eq(supplyRunLines.id, input.lineId),
          eq(supplyRunLines.runId, input.runId),
        ),
      )
      .limit(1)
      .for("update");
    if (!line) {
      throw new SupplyError("Proposition introuvable dans ce calcul.");
    }
    if (line.decision !== "pending") {
      throw new SupplyError("Seule une proposition en attente peut être écartée.");
    }

    await tx
      .update(supplyRunLines)
      .set({
        decision: "dismissed",
        decisionReason: parsed.reason,
        decidedBy: input.actorUserId,
        decidedAt: new Date(),
      })
      .where(and(eq(supplyRunLines.tenantId, input.tenantId), eq(supplyRunLines.id, input.lineId)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "supply.line.dismiss",
      entityType: "supply_run",
      entityId: line.runId,
      details: {
        lineNumber: line.lineNumber,
        reason: parsed.reason,
      },
    });

    return { lineId: line.id };
  });
}
