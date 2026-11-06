import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, memberships, taskSettings, type TaskPriority } from "@/db/schema";
import { isoDatePlusDays } from "@/lib/dates";
import { TASK_PRIORITIES } from "./constants";
import { TasksError } from "./errors";

export const MIN_DEFAULT_TASK_DUE_IN_DAYS = 0;
export const MAX_DEFAULT_TASK_DUE_IN_DAYS = 365;

export interface TaskSettingsRecord {
  readonly id: string;
  readonly defaultPriority: TaskPriority;
  readonly defaultDueInDays: number;
  readonly defaultAssigneeUserId: string | null;
}

export interface TaskSettingsView extends TaskSettingsRecord {
  readonly updatedAt: Date;
}

/** TSK-007 — l'absence de réglage conserve les défauts actuels : priorité normale, sans échéance ni assigné. */
export async function loadTaskSettings(
  db: Database,
  tenantId: string,
): Promise<TaskSettingsRecord | null> {
  const [row] = await db
    .select({
      id: taskSettings.id,
      defaultPriority: taskSettings.defaultPriority,
      defaultDueInDays: taskSettings.defaultDueInDays,
      defaultAssigneeUserId: taskSettings.defaultAssigneeUserId,
    })
    .from(taskSettings)
    .where(eq(taskSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getTaskSettingsView(
  db: Database,
  tenantId: string,
): Promise<TaskSettingsView | null> {
  const [row] = await db
    .select({
      id: taskSettings.id,
      defaultPriority: taskSettings.defaultPriority,
      defaultDueInDays: taskSettings.defaultDueInDays,
      defaultAssigneeUserId: taskSettings.defaultAssigneeUserId,
      updatedAt: taskSettings.updatedAt,
    })
    .from(taskSettings)
    .where(eq(taskSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export function defaultTaskDueDate(
  today: string,
  settings: TaskSettingsRecord | null,
): string | null {
  const days = settings?.defaultDueInDays ?? MIN_DEFAULT_TASK_DUE_IN_DAYS;
  return days === 0 ? null : isoDatePlusDays(today, days);
}

export interface SaveTaskSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly defaultPriority: unknown;
    readonly defaultDueInDays: unknown;
    readonly defaultAssigneeUserId: unknown;
  };
}

function priorityOf(raw: unknown): TaskPriority {
  if (typeof raw === "string" && (TASK_PRIORITIES as readonly string[]).includes(raw)) {
    return raw as TaskPriority;
  }
  throw new TasksError("Priorité par défaut inconnue.");
}

function dueInDaysOf(raw: unknown): number {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") {
    return MIN_DEFAULT_TASK_DUE_IN_DAYS;
  }
  if (!/^\d+$/.test(text)) {
    throw new TasksError("Délai d'échéance par défaut : nombre entier de jours attendu.");
  }
  const value = Number(text);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_DEFAULT_TASK_DUE_IN_DAYS ||
    value > MAX_DEFAULT_TASK_DUE_IN_DAYS
  ) {
    throw new TasksError(
      `Délai d'échéance par défaut : entre ${MIN_DEFAULT_TASK_DUE_IN_DAYS} et ${MAX_DEFAULT_TASK_DUE_IN_DAYS} jours.`,
    );
  }
  return value;
}

function assigneeUserIdOf(raw: unknown): string | null {
  const value = raw === null || raw === undefined ? "" : String(raw).trim();
  return value === "" ? null : value;
}

/** TSK-007 — un assigné par défaut, s'il existe, doit être membre du même espace. */
export async function saveTaskSettings(
  db: Database,
  input: SaveTaskSettingsInput,
): Promise<{ created: boolean }> {
  const defaultPriority = priorityOf(input.raw.defaultPriority);
  const defaultDueInDays = dueInDaysOf(input.raw.defaultDueInDays);
  const defaultAssigneeUserId = assigneeUserIdOf(input.raw.defaultAssigneeUserId);

  return db.transaction(async (tx) => {
    if (defaultAssigneeUserId) {
      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, defaultAssigneeUserId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new TasksError("L'assigné par défaut doit être un membre de l'espace.");
      }
    }

    const [existing] = await tx
      .select({ id: taskSettings.id })
      .from(taskSettings)
      .where(eq(taskSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      defaultPriority,
      defaultDueInDays,
      defaultAssigneeUserId,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(taskSettings)
      .values(values)
      .onConflictDoUpdate({
        target: taskSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "task.settings.update",
      entityType: "task_settings",
      entityId: input.tenantId,
      details: {
        created: !existing,
        defaultPriority,
        defaultDueInDays,
        defaultAssigneeUserId,
      },
    });

    return { created: !existing };
  });
}
