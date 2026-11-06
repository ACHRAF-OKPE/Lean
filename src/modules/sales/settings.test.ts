import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, invoiceSettings, salesSettings } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant } from "@/test/sales";
import { SalesError } from "./errors";
import {
  defaultInvoiceDueDate,
  getInvoiceSettingsView,
  loadInvoiceSettings,
  saveInvoiceSettings,
} from "./invoice-settings";
import { getSalesSettingsView, loadSalesSettings, saveSalesSettings } from "./settings";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("SAL-009 — paramétrage des ventes", () => {
  it("crée puis met à jour le délai de livraison par défaut, avec audit", async () => {
    const ids = await seedSalesTenant(db, "sal009-save");

    expect(await loadSalesSettings(db, ids.tenantId)).toBeNull();
    expect(await getSalesSettingsView(db, ids.tenantId)).toBeNull();

    const created = await saveSalesSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultDeliveryDelayDays: "30" },
    });
    expect(created).toEqual({ created: true });
    expect(await loadSalesSettings(db, ids.tenantId)).toMatchObject({
      defaultDeliveryDelayDays: 30,
    });
    expect((await getSalesSettingsView(db, ids.tenantId))?.defaultDeliveryDelayDays).toBe(30);

    const updated = await saveSalesSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultDeliveryDelayDays: "" },
    });
    expect(updated).toEqual({ created: false });
    expect(await loadSalesSettings(db, ids.tenantId)).toMatchObject({
      defaultDeliveryDelayDays: 0,
    });

    const rows = await db
      .select({ value: salesSettings.id })
      .from(salesSettings)
      .where(eq(salesSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "sales.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse un délai hors borne, décimal ou non numérique sans rien écrire", async () => {
    const ids = await seedSalesTenant(db, "sal009-refusals");

    for (const raw of ["-1", "366", "abc", "12,5"]) {
      await expect(
        saveSalesSettings(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          raw: { defaultDeliveryDelayDays: raw },
        }),
      ).rejects.toThrow(SalesError);
    }

    const rows = await db
      .select({ value: salesSettings.id })
      .from(salesSettings)
      .where(eq(salesSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(0);
  });

  it("isole le paramétrage entre deux espaces", async () => {
    const first = await seedSalesTenant(db, "sal009-iso-a");
    const second = await seedSalesTenant(db, "sal009-iso-b");

    await saveSalesSettings(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      raw: { defaultDeliveryDelayDays: "15" },
    });

    expect(await loadSalesSettings(db, second.tenantId)).toBeNull();
    expect((await loadSalesSettings(db, first.tenantId))?.defaultDeliveryDelayDays).toBe(15);
  });
});

describe("SAL-010 — paramétrage des factures", () => {
  it("propose l'échéance à partir de la date de facture, avec 30 jours sans réglage", () => {
    expect(defaultInvoiceDueDate("2026-02-28", null)).toBe("2026-03-30");
    expect(defaultInvoiceDueDate("2026-02-28", { id: "settings", dueDateOffsetDays: 0 })).toBe(
      "2026-02-28",
    );
    expect(defaultInvoiceDueDate("2026-02-28", { id: "settings", dueDateOffsetDays: 45 })).toBe(
      "2026-04-14",
    );
  });

  it("crée puis met à jour le délai d'échéance, avec une trace d'audit", async () => {
    const ids = await seedSalesTenant(db, "sal010-save");

    expect(await loadInvoiceSettings(db, ids.tenantId)).toBeNull();
    expect(await getInvoiceSettingsView(db, ids.tenantId)).toBeNull();

    const created = await saveInvoiceSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { dueDateOffsetDays: "45" },
    });
    expect(created).toEqual({ created: true });
    expect(await loadInvoiceSettings(db, ids.tenantId)).toMatchObject({ dueDateOffsetDays: 45 });
    expect((await getInvoiceSettingsView(db, ids.tenantId))?.dueDateOffsetDays).toBe(45);

    const updated = await saveInvoiceSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { dueDateOffsetDays: "0" },
    });
    expect(updated).toEqual({ created: false });
    expect(await loadInvoiceSettings(db, ids.tenantId)).toMatchObject({ dueDateOffsetDays: 0 });

    const rows = await db
      .select({ id: invoiceSettings.id })
      .from(invoiceSettings)
      .where(eq(invoiceSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "invoice.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse un délai hors borne, décimal ou non numérique sans rien écrire", async () => {
    const ids = await seedSalesTenant(db, "sal010-refusals");

    for (const raw of ["-1", "366", "abc", "12,5"]) {
      await expect(
        saveInvoiceSettings(db, {
          tenantId: ids.tenantId,
          actorUserId: ids.userId,
          raw: { dueDateOffsetDays: raw },
        }),
      ).rejects.toThrow(SalesError);
    }

    const rows = await db
      .select({ id: invoiceSettings.id })
      .from(invoiceSettings)
      .where(eq(invoiceSettings.tenantId, ids.tenantId));
    expect(rows).toHaveLength(0);
  });

  it("isole le délai entre deux espaces", async () => {
    const first = await seedSalesTenant(db, "sal010-iso-a");
    const second = await seedSalesTenant(db, "sal010-iso-b");

    await saveInvoiceSettings(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      raw: { dueDateOffsetDays: "15" },
    });

    expect(await loadInvoiceSettings(db, second.tenantId)).toBeNull();
    expect((await loadInvoiceSettings(db, first.tenantId))?.dueDateOffsetDays).toBe(15);
  });
});
