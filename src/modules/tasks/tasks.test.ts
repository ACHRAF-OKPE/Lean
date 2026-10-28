import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, discussionMessages, notifications } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { seedCollaborationTenant, type CollaborationTenant } from "@/test/collaboration";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { TasksError } from "./errors";
import { START_WITHOUT_ASSIGNEE, UNASSIGN_RUNNING } from "./lifecycle";
import {
  assignTask,
  changeTaskStatus,
  createTask,
  getTask,
  listTasks,
  listTasksForEntity,
  taskCounters,
  updateTask,
} from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

let counter = 0;
function setup(label: string): Promise<CollaborationTenant> {
  counter += 1;
  return seedCollaborationTenant(db, `${label}-${counter}`);
}

interface RawOverrides {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  assigneeUserId?: unknown;
  relatedEntityType?: unknown;
  relatedEntityId?: unknown;
}

async function makeTask(
  tenant: CollaborationTenant,
  overrides: RawOverrides = {},
  actorUserId: string = tenant.userId,
): Promise<string> {
  const created = await createTask(db, {
    tenantId: tenant.tenantId,
    actorUserId,
    raw: {
      title: "Relancer la facture",
      description: "",
      priority: "normal",
      dueDate: "",
      assigneeUserId: "",
      relatedEntityType: "",
      relatedEntityId: "",
      ...overrides,
    },
  });
  return created.taskId;
}

async function eventMessages(tenant: CollaborationTenant, taskId: string) {
  return db
    .select({
      eventType: discussionMessages.eventType,
      body: discussionMessages.body,
      eventKey: discussionMessages.eventKey,
    })
    .from(discussionMessages)
    .where(
      and(
        eq(discussionMessages.tenantId, tenant.tenantId),
        eq(discussionMessages.entityType, "task"),
        eq(discussionMessages.entityId, taskId),
      ),
    );
}

function yesterday(): string {
  const date = new Date(`${todayIsoDate()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

describe("TSK-001 — modèle de tâche", () => {
  it("refuse un titre vide ou trop long, une description trop longue et une priorité inconnue", async () => {
    const tenant = await setup("tsk-001-validation");

    await expect(makeTask(tenant, { title: "   " })).rejects.toThrow("Le titre est obligatoire.");
    await expect(makeTask(tenant, { title: "x".repeat(161) })).rejects.toThrow(
      "Le titre ne peut pas dépasser 160 caractères.",
    );
    await expect(makeTask(tenant, { description: "x".repeat(4001) })).rejects.toThrow(
      "La description ne peut pas dépasser 4000 caractères.",
    );
    await expect(makeTask(tenant, { priority: "immédiate" })).rejects.toThrow("Priorité inconnue");
    await expect(makeTask(tenant, { dueDate: "2026-13-01" })).rejects.toThrow(
      "Échéance : date invalide.",
    );
  });

  it("refuse un assigné hors espace et un document d'un autre espace", async () => {
    const tenant = await setup("tsk-001-isolation");

    await expect(makeTask(tenant, { assigneeUserId: randomUUID() })).rejects.toBeInstanceOf(
      TasksError,
    );
    await expect(
      makeTask(tenant, {
        relatedEntityType: "partner",
        relatedEntityId: tenant.otherPartnerId,
      }),
    ).rejects.toThrow("Document lié introuvable dans cet espace de travail.");
  });

  it("crée une tâche normalisée, auditée sans sa description", async () => {
    const tenant = await setup("tsk-001-create");
    const secret = "Description interne confidentielle";

    const taskId = await makeTask(tenant, {
      title: "  Vérifier le classement tarifaire  ",
      description: `  ${secret}  `,
      priority: "Haute",
      dueDate: "2026-11-15",
      assigneeUserId: tenant.memberUserId,
      relatedEntityType: "partner",
      relatedEntityId: tenant.supplierId,
    });

    const task = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(task).not.toBeNull();
    expect(task?.title).toBe("Vérifier le classement tarifaire");
    expect(task?.description).toBe(secret);
    expect(task?.priority).toBe("high");
    expect(task?.status).toBe("open");
    expect(task?.dueDate).toBe("2026-11-15");
    expect(task?.assigneeUserId).toBe(tenant.memberUserId);
    expect(task?.assigneeName).toBe(tenant.memberName);
    expect(task?.relatedEntityType).toBe("partner");
    expect(task?.relatedEntityId).toBe(tenant.supplierId);
    expect(task?.relatedLabel).toContain("FOUR001");
    expect(task?.createdByName).toBeTruthy();

    const [audit] = await db
      .select({ details: auditEvents.details, action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "task.create"),
          eq(auditEvents.entityId, taskId),
        ),
      );
    expect(audit).toBeDefined();
    const details = JSON.stringify(audit?.details);
    expect(details).toContain("Vérifier le classement tarifaire");
    expect(details).toContain("high");
    expect(details).toContain(tenant.supplierId);
    expect(details).not.toContain(secret);
  });
});

describe("TSK-002 — cycle de vie", () => {
  it("accepte les transitions prévues et refuse les autres", async () => {
    const tenant = await setup("tsk-002-transitions");
    const taskId = await makeTask(tenant);
    await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.memberUserId,
    });

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "in_progress",
    });
    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "done",
    });

    const done = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(done?.status).toBe("done");
    expect(done?.completedAt).not.toBeNull();
    expect(done?.completedByName).toBeTruthy();

    await expect(
      changeTaskStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        status: "cancelled",
      }),
    ).rejects.toThrow("Transition refusée");

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "open",
    });
    const reopened = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(reopened?.status).toBe("open");
    expect(reopened?.completedAt).toBeNull();
    expect(reopened?.completedByName).toBeNull();

    await expect(
      changeTaskStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        status: "in_progress",
      }),
    ).resolves.toBeDefined();

    await expect(
      changeTaskStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        status: "open",
      }),
    ).rejects.toThrow("Transition refusée");
  });

  it("fige une tâche terminée jusqu'à sa réouverture", async () => {
    const tenant = await setup("tsk-002-freeze");
    const taskId = await makeTask(tenant);

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "done",
    });

    await expect(
      updateTask(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        raw: {
          title: "Titre modifié",
          description: "",
          priority: "normal",
          dueDate: "",
          assigneeUserId: "",
          relatedEntityType: "",
          relatedEntityId: "",
        },
      }),
    ).rejects.toThrow("Rouvrez la tâche avant de la modifier.");

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "open",
    });

    const result = await updateTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      raw: {
        title: "Titre modifié",
        description: "",
        priority: "normal",
        dueDate: "",
        assigneeUserId: "",
        relatedEntityType: "",
        relatedEntityId: "",
      },
    });
    expect(result.updated).toBe(true);
  });

  it("écrit un événement de fil et un audit avant/après par transition", async () => {
    const tenant = await setup("tsk-002-events");
    const taskId = await makeTask(tenant, { assigneeUserId: tenant.memberUserId });

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "in_progress",
    });
    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "done",
    });

    const messages = await eventMessages(tenant, taskId);
    const statusEvents = messages.filter((message) => message.eventType === "task.status");
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[0]?.body).toContain("« Ouverte » à « En cours »");
    expect(statusEvents[1]?.body).toContain("« En cours » à « Terminée »");

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "task.status"),
          eq(auditEvents.entityId, taskId),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits[0]?.details)).toContain('"from":"open"');
    expect(JSON.stringify(audits[1]?.details)).toContain('"to":"done"');
  });
});

describe("TSK-003 — assignation", () => {
  it("assigne, réassigne et désassigne avec un événement et une notification par membre", async () => {
    const tenant = await setup("tsk-003-assign");
    const taskId = await makeTask(tenant, { description: "SECRET-DESCRIPTION" });
    const notifiedBefore = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenant.tenantId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, taskId),
        ),
      );

    const assigned = await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.memberUserId,
    });
    expect(assigned.changed).toBe(true);

    let events = (await eventMessages(tenant, taskId)).filter(
      (message) => message.eventType === "task.assignee",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.body).toContain(`assignée à ${tenant.memberName}`);
    expect(events[0]?.body).not.toContain("SECRET-DESCRIPTION");

    const notified = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenant.tenantId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, taskId),
        ),
      );
    expect(notified).toHaveLength(notifiedBefore.length + 2);
    for (const userId of [tenant.userId, tenant.memberUserId]) {
      const before = notifiedBefore.filter((row) => row.userId === userId).length;
      const after = notified.filter((row) => row.userId === userId).length;
      expect(after).toBe(before + 1);
    }

    const replay = await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.memberUserId,
    });
    expect(replay.changed).toBe(false);
    expect(
      (await eventMessages(tenant, taskId)).filter(
        (message) => message.eventType === "task.assignee",
      ),
    ).toHaveLength(1);

    await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.userId,
    });
    const reassigned = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(reassigned?.assigneeUserId).toBe(tenant.userId);

    const audits = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "task.assign"),
          eq(auditEvents.entityId, taskId),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits[0]?.details)).toContain(tenant.memberUserId);

    await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: null,
    });
    events = (await eventMessages(tenant, taskId)).filter(
      (message) => message.eventType === "task.assignee",
    );
    expect(events).toHaveLength(3);
    expect(events[2]?.body).toContain("n'est plus assignée");
    expect((await getTask(db, { tenantId: tenant.tenantId, taskId }))?.assigneeUserId).toBeNull();
  });

  it("refuse un assigné qui n'est pas membre de l'espace", async () => {
    const tenant = await setup("tsk-003-outsider");
    const taskId = await makeTask(tenant);

    await expect(
      assignTask(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        assigneeUserId: tenant.otherTenantUserId,
      }),
    ).rejects.toThrow("L'assigné doit être un membre de l'espace.");
    expect((await getTask(db, { tenantId: tenant.tenantId, taskId }))?.assigneeUserId).toBeNull();
  });
});

describe("TSK-004 — suivi et isolation", () => {
  it("filtre par statut, priorité, assigné et retard, et calcule les compteurs", async () => {
    const tenant = await setup("tsk-004-filters");

    await makeTask(tenant, {
      title: "Urgente en retard",
      priority: "urgent",
      dueDate: yesterday(),
      assigneeUserId: tenant.userId,
    });
    await makeTask(tenant, { title: "Normale future", dueDate: "2026-12-31" });
    const doneId = await makeTask(tenant, {
      title: "Terminée",
      priority: "urgent",
      dueDate: yesterday(),
    });
    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId: doneId,
      status: "done",
    });

    const active = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { status: "active" },
    });
    expect(active.map((task) => task.title)).toEqual(["Urgente en retard", "Normale future"]);

    const urgent = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { status: "all", priority: "urgent" },
    });
    expect(urgent).toHaveLength(2);

    const mine = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { assignee: "me" },
    });
    expect(mine.map((task) => task.title)).toEqual(["Urgente en retard"]);

    const unassigned = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { status: "active", assignee: "unassigned" },
    });
    expect(unassigned.map((task) => task.title)).toEqual(["Normale future"]);

    const overdue = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { status: "all", overdue: true },
    });
    expect(overdue.map((task) => task.title)).toEqual(["Urgente en retard"]);

    const counters = await taskCounters(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
    });
    expect(counters).toEqual({ active: 2, overdue: 1, mine: 1 });
  });

  it("liste les tâches ouvertes d'un document et les isole par espace", async () => {
    const tenant = await setup("tsk-004-document");
    const linkedId = await makeTask(tenant, {
      title: "Liée au fournisseur",
      relatedEntityType: "partner",
      relatedEntityId: tenant.supplierId,
    });
    const closedLinkedId = await makeTask(tenant, {
      title: "Liée terminée",
      relatedEntityType: "partner",
      relatedEntityId: tenant.supplierId,
    });
    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId: closedLinkedId,
      status: "done",
    });

    const linked = await listTasksForEntity(db, {
      tenantId: tenant.tenantId,
      entityType: "partner",
      entityId: tenant.supplierId,
    });
    expect(linked.map((task) => task.id)).toEqual([linkedId]);

    const otherTaskId = await makeTask(
      {
        ...tenant,
        tenantId: tenant.otherTenantId,
        userId: tenant.otherTenantUserId,
      },
      { title: "Tâche voisine" },
      tenant.otherTenantUserId,
    );

    const tenantTasks = await listTasks(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      filters: { status: "all" },
    });
    expect(tenantTasks.some((task) => task.id === otherTaskId)).toBe(false);
    expect(await getTask(db, { tenantId: tenant.tenantId, taskId: otherTaskId })).toBeNull();
    await expect(
      changeTaskStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId: otherTaskId,
        status: "in_progress",
      }),
    ).rejects.toThrow("Tâche introuvable dans cet espace de travail.");
  });
});

describe("TSK-006 — chronométrage et démarrage conditionné", () => {
  it("refuse de démarrer une tâche non assignée puis arme le chronomètre", async () => {
    const tenant = await setup("tsk-006-start");
    const taskId = await makeTask(tenant);

    await expect(
      changeTaskStatus(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        status: "in_progress",
      }),
    ).rejects.toThrow(START_WITHOUT_ASSIGNEE);

    let task = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(task?.status).toBe("open");
    expect(task?.startedAt).toBeNull();
    expect(task?.elapsedSeconds).toBe(0);

    await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.memberUserId,
    });
    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "in_progress",
    });

    task = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(task?.status).toBe("in_progress");
    expect(task?.startedAt).not.toBeNull();
    expect(task?.elapsedSeconds).toBe(0);
  });

  it("interdit de désassigner une tâche en cours et conserve le cumul à la réouverture", async () => {
    const tenant = await setup("tsk-006-unassign");
    const taskId = await makeTask(tenant, { assigneeUserId: tenant.memberUserId });

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "in_progress",
    });

    await expect(
      assignTask(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        taskId,
        assigneeUserId: null,
      }),
    ).rejects.toThrow(UNASSIGN_RUNNING);
    expect((await getTask(db, { tenantId: tenant.tenantId, taskId }))?.assigneeUserId).toBe(
      tenant.memberUserId,
    );

    await assignTask(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      assigneeUserId: tenant.userId,
    });
    const reassigned = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(reassigned?.status).toBe("in_progress");
    expect(reassigned?.assigneeUserId).toBe(tenant.userId);
    expect(reassigned?.startedAt).not.toBeNull();

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "done",
    });
    const done = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(done?.startedAt).toBeNull();
    expect(done?.elapsedSeconds).toBeGreaterThanOrEqual(0);

    await changeTaskStatus(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      taskId,
      status: "open",
    });
    const reopened = await getTask(db, { tenantId: tenant.tenantId, taskId });
    expect(reopened?.status).toBe("open");
    expect(reopened?.startedAt).toBeNull();
    expect(reopened?.elapsedSeconds).toBe(done?.elapsedSeconds);
  });
});
