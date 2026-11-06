import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, taskSettings } from "@/db/schema";
import { seedCollaborationTenant } from "@/test/collaboration";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { TasksError } from "./errors";
import {
  defaultTaskDueDate,
  getTaskSettingsView,
  loadTaskSettings,
  saveTaskSettings,
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

describe("TSK-007 — paramétrage des tâches", () => {
  it("propose les valeurs par défaut et calcule l'échéance à partir du jour courant", () => {
    expect(defaultTaskDueDate("2026-02-28", null)).toBeNull();
    expect(
      defaultTaskDueDate("2026-02-28", {
        id: "settings",
        defaultPriority: "high",
        defaultDueInDays: 0,
        defaultAssigneeUserId: null,
      }),
    ).toBeNull();
    expect(
      defaultTaskDueDate("2026-02-28", {
        id: "settings",
        defaultPriority: "high",
        defaultDueInDays: 10,
        defaultAssigneeUserId: null,
      }),
    ).toBe("2026-03-10");
  });

  it("crée puis met à jour les valeurs par défaut, avec une trace d'audit", async () => {
    const tenant = await seedCollaborationTenant(db, "tsk007-save");

    expect(await loadTaskSettings(db, tenant.tenantId)).toBeNull();
    expect(await getTaskSettingsView(db, tenant.tenantId)).toBeNull();

    const created = await saveTaskSettings(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        defaultPriority: "urgent",
        defaultDueInDays: "14",
        defaultAssigneeUserId: tenant.memberUserId,
      },
    });
    expect(created).toEqual({ created: true });
    expect(await loadTaskSettings(db, tenant.tenantId)).toMatchObject({
      defaultPriority: "urgent",
      defaultDueInDays: 14,
      defaultAssigneeUserId: tenant.memberUserId,
    });
    expect((await getTaskSettingsView(db, tenant.tenantId))?.updatedAt).toBeInstanceOf(Date);

    const updated = await saveTaskSettings(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        defaultPriority: "low",
        defaultDueInDays: "0",
        defaultAssigneeUserId: "",
      },
    });
    expect(updated).toEqual({ created: false });
    expect(await loadTaskSettings(db, tenant.tenantId)).toMatchObject({
      defaultPriority: "low",
      defaultDueInDays: 0,
      defaultAssigneeUserId: null,
    });

    const rows = await db
      .select({ id: taskSettings.id })
      .from(taskSettings)
      .where(eq(taskSettings.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "task.settings.update"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("refuse une priorité, un délai ou un assigné invalide sans écrire", async () => {
    const tenant = await seedCollaborationTenant(db, "tsk007-invalid");
    const invalidInputs = [
      { defaultPriority: "instantanée", defaultDueInDays: "10", defaultAssigneeUserId: "" },
      { defaultPriority: "high", defaultDueInDays: "366", defaultAssigneeUserId: "" },
      { defaultPriority: "high", defaultDueInDays: "1,5", defaultAssigneeUserId: "" },
      {
        defaultPriority: "high",
        defaultDueInDays: "10",
        defaultAssigneeUserId: tenant.otherTenantUserId,
      },
    ];

    for (const raw of invalidInputs) {
      await expect(
        saveTaskSettings(db, {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          raw,
        }),
      ).rejects.toThrow(TasksError);
    }

    const rows = await db
      .select({ id: taskSettings.id })
      .from(taskSettings)
      .where(eq(taskSettings.tenantId, tenant.tenantId));
    expect(rows).toHaveLength(0);
  });

  it("isole les réglages entre deux espaces", async () => {
    const first = await seedCollaborationTenant(db, "tsk007-iso-a");
    const second = await seedCollaborationTenant(db, "tsk007-iso-b");

    await saveTaskSettings(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      raw: {
        defaultPriority: "high",
        defaultDueInDays: "7",
        defaultAssigneeUserId: first.memberUserId,
      },
    });

    expect(await loadTaskSettings(db, second.tenantId)).toBeNull();
    expect((await loadTaskSettings(db, first.tenantId))?.defaultAssigneeUserId).toBe(
      first.memberUserId,
    );
  });
});
