import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, importRows, salesOrderLines, salesOrders } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant, type SalesTenant } from "@/test/sales";
import { analyzeImport, applyImportBatch, getImportBatch } from "@/modules/catalog/imports";
import type { RawImportRow } from "@/modules/catalog/validation";

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

function salesRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      client: "CUST001",
      article: "ART001",
      quantite: "2",
      prix_unitaire_xof: "1500",
      date_livraison_prevue: "2099-12-01",
      reference_externe: "CLI-2026-001",
      ...overrides,
    },
  };
}

async function analyze(
  ids: SalesTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("ventes"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "sales_lines",
    fileName: "ventes.xlsx",
    fileHash,
    sheetName: "Données",
    rows,
    notes: [],
  });
}

describe("SAL-008 — import XLSX des lignes de commande client", () => {
  it("n'écrit rien à l'analyse puis crée une commande brouillon par groupe", async () => {
    const ids = await seedSalesTenant(db, "sal008-groupes");
    const hash = hashOf("sal008-groupes");

    const rows = [
      salesRow(2),
      salesRow(3, { article: "ART002", quantite: "1.5", prix_unitaire_xof: "700" }),
      salesRow(4, { quantite: "1", date_livraison_prevue: "2099-12-15" }),
      salesRow(5, {
        article: "SRV001",
        quantite: "2",
        prix_unitaire_xof: "75000",
        reference_externe: "CLI-2026-002",
      }),
    ];
    const analysis = await analyze(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(0);
    expect(analysis.notes.join(" ")).toMatch(/3 commandes client en brouillon/);

    const [beforeApply] = await db
      .select({ value: count() })
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, ids.tenantId));
    expect(beforeApply?.value).toBe(0);

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ kind: "sales_lines", written: 4, orders: 3 });

    const orders = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, ids.tenantId))
      .orderBy(asc(salesOrders.exTaxTotal));
    expect(orders).toHaveLength(3);
    expect(orders.map((order) => order.exTaxTotal)).toEqual([1500, 4050, 150000]);
    for (const order of orders) {
      expect(order.status).toBe("draft");
      expect(order.number).toBeNull();
      expect(order.invoicingState).toBe("not_invoiced");
      expect(order.customerId).toBe(ids.customerId);
    }
    expect(orders[0]?.deliveryState).toBe("not_delivered");
    expect(orders[1]?.deliveryState).toBe("not_delivered");
    expect(orders[2]?.deliveryState).toBe("delivered");

    const twoLineOrder = orders.find((order) => order.exTaxTotal === 4050);
    const twoLineRows = await db
      .select({ articleId: salesOrderLines.articleId, qty: salesOrderLines.qty })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, twoLineOrder!.id))
      .orderBy(asc(salesOrderLines.lineNumber));
    expect(twoLineRows).toHaveLength(2);
    expect(twoLineRows.map((line) => line.qty)).toEqual(["2.000000", "1.500000"]);

    const storedRows = await db
      .select({ rowNumber: importRows.rowNumber, entityId: importRows.entityId })
      .from(importRows)
      .where(eq(importRows.batchId, analysis.batchId))
      .orderBy(asc(importRows.rowNumber));
    expect(storedRows.every((row) => row.entityId !== null)).toBe(true);
    expect(storedRows[0]?.entityId).toBe(storedRows[1]?.entityId);
    expect(storedRows[2]?.entityId).not.toBe(storedRows[0]?.entityId);
    expect(storedRows[3]?.entityId).not.toBe(storedRows[0]?.entityId);

    const audits = await db
      .select({ entityId: auditEvents.entityId, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "sales.order.create")),
      );
    expect(audits).toHaveLength(3);
    expect(
      audits.every((audit) => (audit.details as { source?: string }).source === "xlsx_import"),
    ).toBe(true);

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été appliqué/);

    const duplicate = await analyze(ids, rows, hash);
    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: duplicate.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/déjà été importé/);
  });

  it("cumule les erreurs de client, d'article, de quantité, de prix et de date", async () => {
    const ids = await seedSalesTenant(db, "sal008-erreurs");

    const rows = [
      salesRow(2, { client: "CLI999" }),
      salesRow(3, { client: "CLI-INACTIF" }),
      salesRow(4, { client: "FOUR001" }),
      salesRow(5, { article: "ART999" }),
      salesRow(6, { article: "ART005" }),
      salesRow(7, { quantite: "0" }),
      salesRow(8, { quantite: "1 000" }),
      salesRow(9, { prix_unitaire_xof: "12.5" }),
      salesRow(10, { date_livraison_prevue: "31/12/2026" }),
    ];
    const analysis = await analyze(ids, rows, hashOf("sal008-erreurs"));
    expect(analysis.errorCount).toBe(9);
    expect(analysis.warningCount).toBe(0);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows).toHaveLength(9);
    expect(detail?.rows.every((row) => row.status === "error")).toBe(true);

    await expect(
      applyImportBatch(db, {
        tenantId: ids.tenantId,
        batchId: analysis.batchId,
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/lignes sont en erreur/);

    const [orders] = await db
      .select({ value: count() })
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, ids.tenantId));
    expect(orders?.value).toBe(0);
  });

  it("accepte les avertissements et conserve les lignes répétées d'un même groupe", async () => {
    const ids = await seedSalesTenant(db, "sal008-avertissements");
    const rows = [
      salesRow(2, {
        quantite: "2",
        prix_unitaire_xof: "1200",
        date_livraison_prevue: "2020-01-10",
      }),
      salesRow(3, {
        quantite: "3",
        prix_unitaire_xof: "1200",
        date_livraison_prevue: "2020-01-10",
      }),
    ];
    const analysis = await analyze(ids, rows, hashOf("sal008-avertissements"));
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    for (const row of detail?.rows ?? []) {
      expect(row.warnings.join(" ")).toMatch(/déjà passée/);
      expect(row.warnings.join(" ")).toMatch(/différent du prix de vente de la fiche ART001/);
      expect(row.warnings.join(" ")).toMatch(/présent plusieurs fois dans le même groupe/);
    }

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ written: 2, orders: 1 });

    const [order] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, ids.tenantId));
    expect(order?.exTaxTotal).toBe(6000);
    expect(order?.expectedDeliveryDate).toBe("2020-01-10");
    expect(order?.externalReference).toBe("CLI-2026-001");

    const lines = await db
      .select({ qty: salesOrderLines.qty, lineTotalXof: salesOrderLines.lineTotalXof })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order!.id))
      .orderBy(asc(salesOrderLines.lineNumber));
    expect(lines.map((line) => line.lineTotalXof)).toEqual([2400, 3600]);
    expect(lines.map((line) => line.qty)).toEqual(["2.000000", "3.000000"]);
  });

  it("normalise les codes en majuscules avant de rattacher le client et l'article", async () => {
    const ids = await seedSalesTenant(db, "sal008-normalisation");
    const rows = [salesRow(2, { client: "cust001", article: "art001", quantite: "1" })];

    const analysis = await analyze(ids, rows, hashOf("sal008-normalisation"));
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(1);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    const warnings = detail?.rows[0]?.warnings.join(" ") ?? "";
    expect(warnings).toMatch(/Client : normalisé en majuscules\./);
    expect(warnings).toMatch(/Article : normalisé en majuscules\./);

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ written: 1, orders: 1 });

    const [order] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, ids.tenantId));
    expect(order?.customerId).toBe(ids.customerId);
    expect(order?.exTaxTotal).toBe(1500);
  });
});
