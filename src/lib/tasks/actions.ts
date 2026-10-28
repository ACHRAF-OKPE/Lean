"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import {
  isTaskRelatedEntityType,
  isTaskStatus,
  TASK_RELATED_LABELS,
} from "@/modules/tasks/constants";
import { TasksError } from "@/modules/tasks/errors";
import { documentKey } from "@/modules/tasks/import-validation";
import { loadTaskImportContext } from "@/modules/tasks/imports";
import {
  assignTask,
  changeTaskStatus,
  createTask,
  getTask,
  updateTask,
} from "@/modules/tasks/queries";
import type { TasksFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): TasksFormState {
  if (error instanceof TasksError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function createTaskAction(
  _state: TasksFormState,
  formData: FormData,
): Promise<TasksFormState> {
  const session = await requirePermission("data.write");
  const db = getDb();

  let relatedEntityType = text(formData, "relatedEntityType").trim();
  let relatedEntityId = text(formData, "relatedEntityId").trim();
  const reference = text(formData, "documentReference").trim();

  if (!relatedEntityId && reference) {
    if (!isTaskRelatedEntityType(relatedEntityType)) {
      return { errors: ["Choisissez le type du document lié."] };
    }
    const context = await loadTaskImportContext(db, session.tenantId);
    const resolved = context.taskDocuments[relatedEntityType].get(documentKey(reference));
    if (!resolved) {
      return {
        errors: [
          `${TASK_RELATED_LABELS[relatedEntityType]} ${reference} : document introuvable dans cet espace.`,
        ],
      };
    }
    relatedEntityId = resolved;
  } else if (!relatedEntityId && relatedEntityType) {
    return { errors: ["Indiquez la référence du document lié, ou choisissez Aucun."] };
  }

  if (!isTaskRelatedEntityType(relatedEntityType)) {
    relatedEntityType = "";
  }

  let taskId: string;
  try {
    const created = await createTask(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        title: text(formData, "title"),
        description: text(formData, "description"),
        priority: text(formData, "priority"),
        dueDate: text(formData, "dueDate"),
        assigneeUserId: text(formData, "assigneeUserId"),
        relatedEntityType,
        relatedEntityId,
      },
    });
    taskId = created.taskId;
  } catch (error) {
    return failure(error);
  }

  redirect(`/taches/${taskId}?cree=1`);
}

export async function updateTaskAction(
  _state: TasksFormState,
  formData: FormData,
): Promise<TasksFormState> {
  const session = await requirePermission("data.write");
  const db = getDb();
  const taskId = text(formData, "taskId");

  if (!UUID_PATTERN.test(taskId)) {
    return { errors: ["Tâche invalide."] };
  }

  const task = await getTask(db, { tenantId: session.tenantId, taskId });
  if (!task) {
    return { errors: ["Tâche introuvable dans cet espace de travail."] };
  }

  try {
    await updateTask(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      taskId,
      raw: {
        title: text(formData, "title"),
        description: text(formData, "description"),
        priority: text(formData, "priority"),
        dueDate: text(formData, "dueDate"),
        assigneeUserId: task.assigneeUserId ?? "",
        relatedEntityType: task.relatedEntityType ?? "",
        relatedEntityId: task.relatedEntityId ?? "",
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/taches/${taskId}?maj=1`);
}

export async function changeTaskStatusAction(
  _state: TasksFormState,
  formData: FormData,
): Promise<TasksFormState> {
  const session = await requirePermission("data.write");
  const taskId = text(formData, "taskId");
  const status = text(formData, "status");

  if (!UUID_PATTERN.test(taskId)) {
    return { errors: ["Tâche invalide."] };
  }
  if (!isTaskStatus(status)) {
    return { errors: ["Statut inconnu."] };
  }

  try {
    await changeTaskStatus(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      taskId,
      status,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/taches/${taskId}?maj=1`);
}

export async function assignTaskAction(
  _state: TasksFormState,
  formData: FormData,
): Promise<TasksFormState> {
  const session = await requirePermission("data.write");
  const taskId = text(formData, "taskId");
  const assignee = text(formData, "assigneeUserId").trim();

  if (!UUID_PATTERN.test(taskId)) {
    return { errors: ["Tâche invalide."] };
  }
  if (assignee && !UUID_PATTERN.test(assignee)) {
    return { errors: ["Assigné invalide : sélectionnez un membre de l'espace."] };
  }

  try {
    await assignTask(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      taskId,
      assigneeUserId: assignee || null,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/taches/${taskId}?maj=1`);
}
