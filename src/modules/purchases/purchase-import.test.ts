import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, importRows, partners, purchaseOrderLines, purchaseOrders } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
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

function purchaseRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      fournisseur: "FOUR001",
      article: "ART001",
      quantite: "2",
      prix_unitaire_xof: "1000",
      date_reception_prevue: "2099-12-01",
      reference_externe: "PO-2026-001",
      ...overrides,
    },
  };
}

async function analyze(
  ids: PurchasingTenant,
  rows: readonly RawImportRow[],
  fileHash = hashOf("commandes"),
) {
  return analyzeImport(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    kind: "purchase_lines",
    fileName: "commandes.xlsx",
    fileHash,
    sheetName: "Données",
    rows,
    notes: [],
  });
}

async function addSupplier(ids: PurchasingTenant, code: string): Promise<void> {
  await db.insert(partners).values({
    tenantId: ids.tenantId,
    code,
    name: `Fournisseur ${code}`,
    type: "company",
    isSupplier: true,
  });
}

describe("PUR-006 — import XLSX des lignes de commande", () => {
  it("n'écrit rien à l'analyse puis crée une commande brouillon par groupe", async () => {
    const ids = await seedPurchasingTenant(db, "pur006-groupes");
    await addSupplier(ids, "FOUR003");
    const hash = hashOf("pur006-groupes");

    const rows = [
      purchaseRow(2),
      purchaseRow(3, { article: "ART002", quantite: "1.5", prix_unitaire_xof: "450" }),
      purchaseRow(4, { fournisseur: "FOUR003", quantite: "3" }),
      purchaseRow(5, {
        quantite: "1",
        date_reception_prevue: "2099-12-15",
        reference_externe: "PO-2026-002",
      }),
    ];
    const analysis = await analyze(ids, rows, hash);
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(0);
    expect(analysis.notes.join(" ")).toMatch(/3 commandes en brouillon/);

    const [beforeApply] = await db
      .select({ value: count() })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ids.tenantId));
    expect(beforeApply?.value).toBe(0);

    const applied = await applyImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
      actorUserId: ids.userId,
    });
    expect(applied).toMatchObject({ kind: "purchase_lines", written: 4, orders: 3 });

    const orders = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ids.tenantId))
      .orderBy(asc(purchaseOrders.exTaxTotal));
    expect(orders).toHaveLength(3);
    expect(orders.map((order) => order.exTaxTotal)).toEqual([1000, 2675, 3000]);
    for (const order of orders) {
      expect(order.status).toBe("draft");
      expect(order.number).toBeNull();
      expect(order.receiptState).toBe("not_received");
    }

    const twoLineOrder = orders.find((order) => order.exTaxTotal === 2675);
    const twoLineRows = await db
      .select({ articleId: purchaseOrderLines.articleId, qty: purchaseOrderLines.qty })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, twoLineOrder!.id))
      .orderBy(asc(purchaseOrderLines.lineNumber));
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
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "purchase.order.create"),
        ),
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

  it("cumule les erreurs de fournisseur, d'article, de quantité, de prix et de date", async () => {
    const ids = await seedPurchasingTenant(db, "pur006-erreurs");

    const rows = [
      purchaseRow(2, { fournisseur: "FOUR999" }),
      purchaseRow(3, { fournisseur: "FOUR002" }),
      purchaseRow(4, { fournisseur: "CUST001" }),
      purchaseRow(5, { article: "ART999" }),
      purchaseRow(6, { article: "ART003" }),
      purchaseRow(7, { article: "ART004" }),
      purchaseRow(8, { quantite: "0" }),
      purchaseRow(9, { quantite: "1 000" }),
      purchaseRow(10, { prix_unitaire_xof: "12.5" }),
      purchaseRow(11, { date_reception_prevue: "31/12/2026" }),
    ];
    const analysis = await analyze(ids, rows, hashOf("pur006-erreurs"));
    expect(analysis.errorCount).toBe(10);
    expect(analysis.warningCount).toBe(0);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    expect(detail?.rows).toHaveLength(10);
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
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ids.tenantId));
    expect(orders?.value).toBe(0);
  });

  it("accepte les avertissements et conserve les lignes répétées d'un même groupe", async () => {
    const ids = await seedPurchasingTenant(db, "pur006-avertissements");
    const rows = [
      purchaseRow(2, {
        quantite: "2",
        prix_unitaire_xof: "1200",
        date_reception_prevue: "2020-01-10",
      }),
      purchaseRow(3, {
        quantite: "3",
        prix_unitaire_xof: "1200",
        date_reception_prevue: "2020-01-10",
      }),
    ];
    const analysis = await analyze(ids, rows, hashOf("pur006-avertissements"));
    expect(analysis.errorCount).toBe(0);
    expect(analysis.warningCount).toBe(2);

    const detail = await getImportBatch(db, {
      tenantId: ids.tenantId,
      batchId: analysis.batchId,
    });
    for (const row of detail?.rows ?? []) {
      expect(row.warnings.join(" ")).toMatch(/déjà passée/);
      expect(row.warnings.join(" ")).toMatch(/différent du prix d'achat/);
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
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ids.tenantId));
    expect(order?.exTaxTotal).toBe(6000);
    expect(order?.expectedReceiptDate).toBe("2020-01-10");
    expect(order?.externalReference).toBe("PO-2026-001");

    const lines = await db
      .select({ qty: purchaseOrderLines.qty, lineTotalXof: purchaseOrderLines.lineTotalXof })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, order!.id))
      .orderBy(asc(purchaseOrderLines.lineNumber));
    expect(lines.map((line) => line.lineTotalXof)).toEqual([2400, 3600]);
  });
});
