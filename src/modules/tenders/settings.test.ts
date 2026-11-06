import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, tenderSettings } from "@/db/schema";
import { seedCollaborationTenant } from "@/test/collaboration";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { TenderError } from "./errors";
import {
  DEFAULT_TENDER_DEADLINE_DAYS,
  defaultTenderDeadlineDate,
  getTenderSettingsView,
  loadTenderSettings,
  saveTenderSettings,
  supplyTenderDeadlineDate,
} from "./settings";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("SCM-013 — paramétrage des appels d'offres", () => {
  it("ne propose aucune date sans réglage et décale la date avec le délai enregistré", () => {
    expect(DEFAULT_TENDER_DEADLINE_DAYS).toBe(7);
    expect(defaultTenderDeadlineDate("2026-02-28", null)).toBeNull();
    expect(supplyTenderDeadlineDate("2026-02-28", null)).toBe("2026-03-07");
    expect(defaultTenderDeadlineDate("2026-02-28", { defaultDeadlineDays: 1 })).toBe("2026-03-01");
    expect(defaultTenderDeadlineDate("2026-02-28", { defaultDeadlineDays: 7 })).toBe("2026-03-07");
    expect(supplyTenderDeadlineDate("2026-02-28", { defaultDeadlineDays: 21 })).toBe("2026-03-21");
  });

  it("crée puis met à jour le délai unique avec audit", async () => {
    const tenant = await seedCollaborationTenant(db, "scm013-save");
    expect(await loadTenderSettings(db, tenant.tenantId)).toBeNull();
    expect(await getTenderSettingsView(db, tenant.tenantId)).toBeNull();

    expect(
      await saveTenderSettings(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { defaultDeadlineDays: "21" },
      }),
    ).toEqual({ created: true });
    expect(await loadTenderSettings(db, tenant.tenantId)).toMatchObject({
      defaultDeadlineDays: 21,
    });
    expect((await getTenderSettingsView(db, tenant.tenantId))?.updatedAt).toBeInstanceOf(Date);

    expect(
      await saveTenderSettings(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { defaultDeadlineDays: "1" },
      }),
    ).toEqual({ created: false });
    const rows = await db
      .select({ id: tenderSettings.id })
      .from(tenderSettings)
      .where(eq(tenderSettings.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(1);
    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "tender.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse les valeurs hors bornes ou non entières sans écriture", async () => {
    const tenant = await seedCollaborationTenant(db, "scm013-invalid");
    for (const value of ["0", "366", "1,5", "-1", "7.2"]) {
      await expect(
        saveTenderSettings(db, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          raw: { defaultDeadlineDays: value },
        }),
      ).rejects.toThrow(TenderError);
    }
    const rows = await db
      .select({ id: tenderSettings.id })
      .from(tenderSettings)
      .where(eq(tenderSettings.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(0);
  });

  it("isole les paramètres par espace", async () => {
    const first = await seedCollaborationTenant(db, "scm013-iso-a");
    const second = await seedCollaborationTenant(db, "scm013-iso-b");
    await saveTenderSettings(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      raw: { defaultDeadlineDays: "14" },
    });
    expect(await loadTenderSettings(db, second.tenantId)).toBeNull();
    expect((await loadTenderSettings(db, first.tenantId))?.defaultDeadlineDays).toBe(14);
  });
});
