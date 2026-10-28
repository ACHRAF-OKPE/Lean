import type { TaskPriority, TaskRelatedEntityType } from "@/db/schema";
import { parseIsoDate } from "@/modules/shared/validation";
import {
  TASK_MAX_DESCRIPTION,
  TASK_MAX_TITLE,
  TASK_PRIORITY_LABELS,
  TASK_RELATED_LABELS,
  isTaskPriority,
  isTaskRelatedEntityType,
} from "./constants";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export interface TaskInputRaw {
  readonly title: unknown;
  readonly description: unknown;
  readonly priority: unknown;
  readonly dueDate: unknown;
  readonly assigneeUserId: unknown;
  readonly relatedEntityType: unknown;
  readonly relatedEntityId: unknown;
}

export interface TaskInput {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly dueDate: string | null;
  readonly assigneeUserId: string | null;
  readonly relatedEntityType: TaskRelatedEntityType | null;
  readonly relatedEntityId: string | null;
}

export interface TaskValidationResult {
  readonly data: TaskInput | null;
  readonly errors: string[];
  readonly warnings: string[];
}

export function parseTaskPriority(raw: unknown): {
  value: TaskPriority | null;
  error: string | null;
  warning: string | null;
} {
  const label = text(raw).trim();
  if (!label) {
    return { value: "normal", error: null, warning: "Priorité vide : Normale appliquée." };
  }
  if (isTaskPriority(label)) {
    return { value: label, error: null, warning: null };
  }
  const normalized = normalizeLabel(label);
  const byLabel = (Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).find(
    ([, value]) => normalizeLabel(value) === normalized,
  );
  if (byLabel) {
    return { value: byLabel[0], error: null, warning: null };
  }
  return {
    value: null,
    error: `Priorité inconnue : « ${label} ». Valeurs autorisées : ${Object.values(
      TASK_PRIORITY_LABELS,
    ).join(", ")}.`,
    warning: null,
  };
}

export function parseTaskRelatedType(raw: unknown): {
  value: TaskRelatedEntityType | null;
  error: string | null;
} {
  const label = text(raw).trim();
  if (!label) {
    return { value: null, error: null };
  }
  if (isTaskRelatedEntityType(label)) {
    return { value: label, error: null };
  }
  const normalized = normalizeLabel(label);
  const byLabel = (Object.entries(TASK_RELATED_LABELS) as [TaskRelatedEntityType, string][]).find(
    ([, value]) => normalizeLabel(value) === normalized,
  );
  if (byLabel) {
    return { value: byLabel[0], error: null };
  }
  return {
    value: null,
    error: `Type de document inconnu : « ${label} ». Valeurs autorisées : ${Object.values(
      TASK_RELATED_LABELS,
    ).join(", ")}.`,
  };
}

export function validateTaskInput(raw: TaskInputRaw): TaskValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawTitle = text(raw.title);
  const title = rawTitle.trim();
  if (!title) {
    errors.push("Le titre est obligatoire.");
  } else if (title.length > TASK_MAX_TITLE) {
    errors.push(`Le titre ne peut pas dépasser ${TASK_MAX_TITLE} caractères.`);
  } else if (title !== rawTitle) {
    warnings.push("Espaces superflus retirés du titre.");
  }

  const rawDescription = text(raw.description);
  const description = rawDescription.trim();
  if (description.length > TASK_MAX_DESCRIPTION) {
    errors.push(`La description ne peut pas dépasser ${TASK_MAX_DESCRIPTION} caractères.`);
  } else if (description !== rawDescription) {
    warnings.push("Espaces superflus retirés de la description.");
  }

  const priority = parseTaskPriority(raw.priority);
  if (priority.error) {
    errors.push(priority.error);
  }
  if (priority.warning) {
    warnings.push(priority.warning);
  }

  const dueDate = parseIsoDate(raw.dueDate, "Échéance");
  errors.push(...dueDate.errors);
  warnings.push(...dueDate.warnings);

  const assigneeText = text(raw.assigneeUserId).trim();
  let assigneeUserId: string | null = null;
  if (assigneeText) {
    if (!UUID_SHAPE.test(assigneeText)) {
      errors.push("Assigné invalide : sélectionnez un membre de l'espace.");
    } else {
      assigneeUserId = assigneeText.toLowerCase();
    }
  }

  const relatedType = parseTaskRelatedType(raw.relatedEntityType);
  if (relatedType.error) {
    errors.push(relatedType.error);
  }
  const relatedIdText = text(raw.relatedEntityId).trim();
  let relatedEntityId: string | null = null;
  if (relatedIdText) {
    if (!UUID_SHAPE.test(relatedIdText)) {
      errors.push("Document lié invalide.");
    } else {
      relatedEntityId = relatedIdText.toLowerCase();
    }
  }
  if ((relatedType.value === null) !== (relatedEntityId === null)) {
    errors.push("Le type et le document lié vont ensemble.");
  }

  if (errors.length > 0) {
    return { data: null, errors, warnings };
  }

  return {
    data: {
      title,
      description,
      priority: priority.value ?? "normal",
      dueDate: dueDate.value,
      assigneeUserId,
      relatedEntityType: relatedType.value,
      relatedEntityId,
    },
    errors,
    warnings,
  };
}
