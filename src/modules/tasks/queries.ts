import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  invoices,
  memberships,
  partners,
  purchaseOrders,
  salesOrders,
  tasks,
  users,
  type TaskPriority,
  type TaskRelatedEntityType,
  type TaskStatus,
} from "@/db/schema";
import { recordDocumentEvent } from "@/modules/discussion/queries";
import type { DocumentEventType } from "@/modules/discussion/events";
import { todayIsoDate } from "@/lib/dates";
import { TASK_ENTITY_PAGE_SIZE, TASK_PAGE_SIZE } from "./constants";
import { TasksError } from "./errors";
import { completionPatch, taskEditError, transitionError } from "./lifecycle";
import { validateTaskInput, type TaskInput, type TaskInputRaw } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface TaskSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly dueDate: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeName: string | null;
  readonly relatedEntityType: TaskRelatedEntityType | null;
  readonly relatedEntityId: string | null;
  readonly relatedLabel: string | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly revision: number;
}

export interface TaskDetail extends TaskSummary {
  readonly createdByName: string | null;
  readonly completedByName: string | null;
}

export interface TaskFilters {
  readonly status?: TaskStatus | "active" | "all";
  readonly priority?: TaskPriority;
  readonly assignee?: "me" | "unassigned" | (string & {});
  readonly overdue?: boolean;
}

export interface TaskCounters {
  readonly active: number;
  readonly overdue: number;
  readonly mine: number;
}

function assertValid(raw: TaskInputRaw): TaskInput {
  const validation = validateTaskInput(raw);
  if (validation.errors.length > 0 || !validation.data) {
    throw new TasksError(validation.errors[0] ?? "Tâche invalide.");
  }
  return validation.data;
}

async function assertAssignee(
  tx: Transaction,
  tenantId: string,
  assigneeUserId: string,
): Promise<void> {
  const [member] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, assigneeUserId)))
    .limit(1);
  if (!member) {
    throw new TasksError("L'assigné doit être un membre de l'espace.");
  }
}

async function assertRelated(
  tx: Transaction,
  tenantId: string,
  entityType: TaskRelatedEntityType,
  entityId: string,
): Promise<void> {
  let found = false;
  switch (entityType) {
    case "partner": {
      const [row] = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(and(eq(partners.tenantId, tenantId), eq(partners.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "purchase_order": {
      const [row] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "sales_order": {
      const [row] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
    case "invoice": {
      const [row] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, entityId)))
        .limit(1);
      found = Boolean(row);
      break;
    }
  }

  if (!found) {
    throw new TasksError("Document lié introuvable dans cet espace de travail.");
  }
}

async function userName(tx: Transaction, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

async function recordTaskEvent(
  tx: Transaction,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taskId: string;
    readonly revision: number;
    readonly type: Extract<DocumentEventType, "task.created" | "task.status" | "task.assignee">;
    readonly title: string;
    readonly status?: TaskStatus;
    readonly previousStatus?: TaskStatus;
    readonly assigneeName?: string | null;
  },
): Promise<void> {
  await recordDocumentEvent(tx, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    entityType: "task",
    entityId: input.taskId,
    event: {
      type: input.type,
      key: `${input.taskId}:${input.revision}`,
      taskTitle: input.title,
      status: input.status,
      previousStatus: input.previousStatus,
      assigneeName: input.assigneeName,
    },
  });
}

export async function createTask(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: TaskInputRaw;
  },
): Promise<{ readonly taskId: string }> {
  const data = assertValid(input.raw);

  return db.transaction(async (tx) => {
    if (data.assigneeUserId) {
      await assertAssignee(tx, input.tenantId, data.assigneeUserId);
    }
    if (data.relatedEntityType && data.relatedEntityId) {
      await assertRelated(tx, input.tenantId, data.relatedEntityType, data.relatedEntityId);
    }

    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: input.tenantId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate,
        assigneeUserId: data.assigneeUserId,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: tasks.id, revision: tasks.revision });
    if (!task) {
      throw new TasksError("La tâche n'a pas pu être enregistrée.");
    }

    const assigneeName = data.assigneeUserId ? await userName(tx, data.assigneeUserId) : null;

    await recordTaskEvent(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      taskId: task.id,
      revision: task.revision,
      type: "task.created",
      title: data.title,
      assigneeName,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "task.create",
      entityType: "task",
      entityId: task.id,
      details: {
        title: data.title,
        priority: data.priority,
        dueDate: data.dueDate,
        assigneeUserId: data.assigneeUserId,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
      },
    });

    return { taskId: task.id };
  });
}

export async function updateTask(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taskId: string;
    readonly raw: TaskInputRaw;
  },
): Promise<{ readonly updated: boolean }> {
  const data = assertValid(input.raw);

  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
      .limit(1)
      .for("update");
    if (!task) {
      throw new TasksError("Tâche introuvable dans cet espace de travail.");
    }
    const editError = taskEditError(task.status);
    if (editError) {
      throw new TasksError(editError);
    }

    if (
      data.relatedEntityType &&
      data.relatedEntityId &&
      (data.relatedEntityType !== task.relatedEntityType ||
        data.relatedEntityId !== task.relatedEntityId)
    ) {
      await assertRelated(tx, input.tenantId, data.relatedEntityType, data.relatedEntityId);
    }

    const changed =
      data.title !== task.title ||
      data.description !== task.description ||
      data.priority !== task.priority ||
      data.dueDate !== task.dueDate ||
      data.relatedEntityType !== task.relatedEntityType ||
      data.relatedEntityId !== task.relatedEntityId;
    if (!changed) {
      return { updated: false };
    }

    await tx
      .update(tasks)
      .set({
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        revision: task.revision + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "task.update",
      entityType: "task",
      entityId: task.id,
      details: {
        before: {
          title: task.title,
          priority: task.priority,
          dueDate: task.dueDate,
          relatedEntityType: task.relatedEntityType,
          relatedEntityId: task.relatedEntityId,
        },
        after: {
          title: data.title,
          priority: data.priority,
          dueDate: data.dueDate,
          relatedEntityType: data.relatedEntityType,
          relatedEntityId: data.relatedEntityId,
        },
        descriptionChanged: data.description !== task.description,
      },
    });

    return { updated: true };
  });
}

export async function changeTaskStatus(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taskId: string;
    readonly status: TaskStatus;
  },
): Promise<{ readonly status: TaskStatus }> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
      .limit(1)
      .for("update");
    if (!task) {
      throw new TasksError("Tâche introuvable dans cet espace de travail.");
    }

    const error = transitionError(task.status, input.status);
    if (error) {
      throw new TasksError(error);
    }

    const now = new Date();
    const completion = completionPatch(input.status, input.actorUserId, now);
    const revision = task.revision + 1;

    await tx
      .update(tasks)
      .set({
        status: input.status,
        ...completion,
        revision,
        updatedAt: now,
      })
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)));

    await recordTaskEvent(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      taskId: task.id,
      revision,
      type: "task.status",
      title: task.title,
      status: input.status,
      previousStatus: task.status,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "task.status",
      entityType: "task",
      entityId: task.id,
      details: { from: task.status, to: input.status },
    });

    return { status: input.status };
  });
}

export async function assignTask(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taskId: string;
    readonly assigneeUserId: string | null;
  },
): Promise<{ readonly changed: boolean }> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
      .limit(1)
      .for("update");
    if (!task) {
      throw new TasksError("Tâche introuvable dans cet espace de travail.");
    }
    const editError = taskEditError(task.status);
    if (editError) {
      throw new TasksError(editError);
    }
    if (task.assigneeUserId === input.assigneeUserId) {
      return { changed: false };
    }
    if (input.assigneeUserId) {
      await assertAssignee(tx, input.tenantId, input.assigneeUserId);
    }

    const revision = task.revision + 1;
    const assigneeName = input.assigneeUserId ? await userName(tx, input.assigneeUserId) : null;

    await tx
      .update(tasks)
      .set({
        assigneeUserId: input.assigneeUserId,
        revision,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)));

    await recordTaskEvent(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      taskId: task.id,
      revision,
      type: "task.assignee",
      title: task.title,
      assigneeName,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "task.assign",
      entityType: "task",
      entityId: task.id,
      details: { from: task.assigneeUserId, to: input.assigneeUserId },
    });

    return { changed: true };
  });
}

async function relatedLabels(
  db: Database,
  tenantId: string,
  rows: readonly {
    relatedEntityType: TaskRelatedEntityType | null;
    relatedEntityId: string | null;
  }[],
): Promise<Map<string, string>> {
  const idsByType = new Map<TaskRelatedEntityType, Set<string>>();
  for (const row of rows) {
    if (!row.relatedEntityType || !row.relatedEntityId) {
      continue;
    }
    const set = idsByType.get(row.relatedEntityType) ?? new Set<string>();
    set.add(row.relatedEntityId);
    idsByType.set(row.relatedEntityType, set);
  }

  const labels = new Map<string, string>();
  const partnerIds = [...(idsByType.get("partner") ?? [])];
  const purchaseIds = [...(idsByType.get("purchase_order") ?? [])];
  const salesIds = [...(idsByType.get("sales_order") ?? [])];
  const invoiceIds = [...(idsByType.get("invoice") ?? [])];

  const [partnerRows, purchaseRows, salesRows, invoiceRows] = await Promise.all([
    partnerIds.length > 0
      ? db
          .select({ id: partners.id, code: partners.code, name: partners.name })
          .from(partners)
          .where(and(eq(partners.tenantId, tenantId), inArray(partners.id, partnerIds)))
      : Promise.resolve([]),
    purchaseIds.length > 0
      ? db
          .select({ id: purchaseOrders.id, number: purchaseOrders.number })
          .from(purchaseOrders)
          .where(
            and(eq(purchaseOrders.tenantId, tenantId), inArray(purchaseOrders.id, purchaseIds)),
          )
      : Promise.resolve([]),
    salesIds.length > 0
      ? db
          .select({ id: salesOrders.id, number: salesOrders.number })
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), inArray(salesOrders.id, salesIds)))
      : Promise.resolve([]),
    invoiceIds.length > 0
      ? db
          .select({ id: invoices.id, number: invoices.number })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, invoiceIds)))
      : Promise.resolve([]),
  ]);

  for (const row of partnerRows) {
    labels.set(`partner:${row.id}`, `${row.name} (${row.code})`);
  }
  for (const row of purchaseRows) {
    labels.set(`purchase_order:${row.id}`, row.number ?? "Commande en brouillon");
  }
  for (const row of salesRows) {
    labels.set(`sales_order:${row.id}`, row.number ?? "Vente en brouillon");
  }
  for (const row of invoiceRows) {
    labels.set(`invoice:${row.id}`, row.number ?? "Facture en brouillon");
  }
  return labels;
}

function withRelatedLabel(
  row: Omit<TaskSummary, "relatedLabel">,
  labels: Map<string, string>,
): TaskSummary {
  return {
    ...row,
    relatedLabel:
      row.relatedEntityType && row.relatedEntityId
        ? (labels.get(`${row.relatedEntityType}:${row.relatedEntityId}`) ?? null)
        : null,
  };
}

const SUMMARY_COLUMNS = {
  id: tasks.id,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  assigneeUserId: tasks.assigneeUserId,
  assigneeName: users.name,
  relatedEntityType: tasks.relatedEntityType,
  relatedEntityId: tasks.relatedEntityId,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  revision: tasks.revision,
} as const;

export async function listTasks(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly filters?: TaskFilters;
    readonly limit?: number;
  },
): Promise<readonly TaskSummary[]> {
  const filters = input.filters ?? {};
  const conditions = [eq(tasks.tenantId, input.tenantId)];

  if (filters.status === "active") {
    conditions.push(inArray(tasks.status, ["open", "in_progress"]));
  } else if (filters.status && filters.status !== "all") {
    conditions.push(eq(tasks.status, filters.status));
  }
  if (filters.priority) {
    conditions.push(eq(tasks.priority, filters.priority));
  }
  if (filters.assignee === "me") {
    conditions.push(eq(tasks.assigneeUserId, input.userId));
  } else if (filters.assignee === "unassigned") {
    conditions.push(isNull(tasks.assigneeUserId));
  } else if (filters.assignee) {
    conditions.push(eq(tasks.assigneeUserId, filters.assignee));
  }
  if (filters.overdue) {
    conditions.push(
      sql`${tasks.dueDate} is not null and ${tasks.dueDate} < ${todayIsoDate()} and ${tasks.status} not in ('done', 'cancelled')`,
    );
  }

  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(and(...conditions))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, desc(tasks.createdAt))
    .limit(input.limit ?? TASK_PAGE_SIZE);

  const labels = await relatedLabels(db, input.tenantId, rows);
  return rows.map((row) => withRelatedLabel(row, labels));
}

export async function getTask(
  db: Database,
  input: { readonly tenantId: string; readonly taskId: string },
): Promise<TaskDetail | null> {
  const [row] = await db
    .select(SUMMARY_COLUMNS)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
    .limit(1);
  if (!row) {
    return null;
  }

  const [creator] = await db
    .select({ name: users.name })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.createdByUserId))
    .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
    .limit(1);
  const [completer] = await db
    .select({ name: users.name })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.completedByUserId))
    .where(and(eq(tasks.tenantId, input.tenantId), eq(tasks.id, input.taskId)))
    .limit(1);

  const labels = await relatedLabels(db, input.tenantId, [row]);
  return {
    ...withRelatedLabel(row, labels),
    createdByName: creator?.name ?? null,
    completedByName: completer?.name ?? null,
  };
}

export async function listTasksForEntity(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly entityType: TaskRelatedEntityType;
    readonly entityId: string;
    readonly limit?: number;
  },
): Promise<readonly TaskSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(
      and(
        eq(tasks.tenantId, input.tenantId),
        eq(tasks.relatedEntityType, input.entityType),
        eq(tasks.relatedEntityId, input.entityId),
        sql`${tasks.status} not in ('done', 'cancelled')`,
      ),
    )
    .orderBy(sql`${tasks.dueDate} asc nulls last`, desc(tasks.createdAt))
    .limit(input.limit ?? TASK_ENTITY_PAGE_SIZE);

  const labels = await relatedLabels(db, input.tenantId, rows);
  return rows.map((row) => withRelatedLabel(row, labels));
}

export async function taskCounters(
  db: Database,
  input: { readonly tenantId: string; readonly userId: string },
): Promise<TaskCounters> {
  const today = todayIsoDate();
  const [row] = await db
    .select({
      active: count(sql`case when ${tasks.status} in ('open', 'in_progress') then 1 end`),
      overdue: count(
        sql`case when ${tasks.dueDate} is not null and ${tasks.dueDate} < ${today} and ${tasks.status} not in ('done', 'cancelled') then 1 end`,
      ),
      mine: count(
        sql`case when ${tasks.assigneeUserId} = ${input.userId} and ${tasks.status} not in ('done', 'cancelled') then 1 end`,
      ),
    })
    .from(tasks)
    .where(eq(tasks.tenantId, input.tenantId));

  return { active: row?.active ?? 0, overdue: row?.overdue ?? 0, mine: row?.mine ?? 0 };
}
