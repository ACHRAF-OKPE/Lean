import type { TaskPriority, TaskRelatedEntityType } from "@/db/schema";
import type {
  RawImportRow,
  ValidatedRow,
  ValidationContext,
  ValidationResult,
} from "@/modules/catalog/validation";
import { parseIsoDate } from "@/modules/shared/validation";
import { todayIsoDate } from "@/lib/dates";
import { TASK_MAX_DESCRIPTION, TASK_MAX_TITLE, TASK_RELATED_LABELS } from "./constants";
import { parseTaskPriority, parseTaskRelatedType } from "./validation";

export interface TaskMemberReference {
  readonly id: string;
  readonly name: string;
}

export interface TaskDocumentMaps {
  readonly partner: ReadonlyMap<string, string>;
  readonly purchase_order: ReadonlyMap<string, string>;
  readonly sales_order: ReadonlyMap<string, string>;
  readonly invoice: ReadonlyMap<string, string>;
}

export interface TaskImportContext {
  readonly taskMembersByEmail?: ReadonlyMap<string, TaskMemberReference>;
  readonly taskDocuments?: TaskDocumentMaps;
  readonly openTaskTitles?: ReadonlySet<string>;
}

export interface TaskImportData {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  relatedEntityType: TaskRelatedEntityType | null;
  relatedEntityId: string | null;
  documentReference: string | null;
}

const MAX_EMAIL_LENGTH = 254;

export function documentKey(value: string): string {
  return value.trim().toUpperCase();
}

export function titleKey(value: string): string {
  return value.trim().toLowerCase();
}

interface Field {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function titleField(raw: unknown): {
  value: string | null;
  errors: string[];
  warnings: string[];
} {
  const rawText = raw === null || raw === undefined ? "" : String(raw);
  const value = rawText.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value) {
    errors.push("Titre : obligatoire.");
    return { value: null, errors, warnings };
  }
  if (value.length > TASK_MAX_TITLE) {
    errors.push(`Titre : ${TASK_MAX_TITLE} caractères maximum.`);
  }
  if (value !== rawText) {
    warnings.push("Titre : espaces de début ou de fin retirés.");
  }
  return { value, errors, warnings };
}

function descriptionField(raw: unknown): Field & { value: string } {
  const rawText = raw === null || raw === undefined ? "" : String(raw);
  const value = rawText.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value.length > TASK_MAX_DESCRIPTION) {
    errors.push(`Description : ${TASK_MAX_DESCRIPTION} caractères maximum.`);
  }
  if (value !== rawText) {
    warnings.push("Description : espaces de début ou de fin retirés.");
  }
  return { value, errors, warnings };
}

function emailField(raw: unknown): {
  value: string | null;
  errors: string[];
  warnings: string[];
} {
  const rawText = raw === null || raw === undefined ? "" : String(raw);
  const trimmed = rawText.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!trimmed) {
    return { value: null, errors, warnings };
  }
  const value = trimmed.toLowerCase();
  if (trimmed !== rawText) {
    warnings.push("Assigné (e-mail) : espaces de début ou de fin retirés.");
  }
  if (value !== trimmed) {
    warnings.push("Assigné (e-mail) : normalisé en minuscules.");
  }
  if (value.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    errors.push("Assigné (e-mail) : adresse invalide.");
  }
  return { value, errors, warnings };
}

function documentReferenceField(raw: unknown): {
  value: string | null;
  errors: string[];
  warnings: string[];
} {
  const rawText = raw === null || raw === undefined ? "" : String(raw);
  const value = rawText.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (value !== rawText) {
    warnings.push("Référence du document : espaces de début ou de fin retirés.");
  }
  return { value: value || null, errors, warnings };
}

export function validateTaskImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
  today: string = todayIsoDate(),
): ValidationResult {
  const members = context.taskMembersByEmail ?? new Map<string, TaskMemberReference>();
  const documents = context.taskDocuments ?? {
    partner: new Map<string, string>(),
    purchase_order: new Map<string, string>(),
    sales_order: new Map<string, string>(),
    invoice: new Map<string, string>(),
  };
  const openTitles = context.openTaskTitles ?? new Set<string>();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const title = titleField(row.values["titre"]);
    const description = descriptionField(row.values["description"]);
    const priority = parseTaskPriority(row.values["priorite"]);
    const dueDate = parseIsoDate(row.values["echeance"], "Échéance");
    const email = emailField(row.values["assigne_email"]);
    const relatedType = parseTaskRelatedType(row.values["document_type"]);
    const reference = documentReferenceField(row.values["document_reference"]);

    errors.push(
      ...title.errors,
      ...description.errors,
      ...dueDate.errors,
      ...email.errors,
      ...reference.errors,
    );
    warnings.push(...title.warnings, ...description.warnings, ...dueDate.warnings);
    warnings.push(...email.warnings, ...reference.warnings);

    if (priority.error) {
      errors.push(priority.error);
    }
    if (priority.warning) {
      warnings.push(priority.warning);
    }
    if (relatedType.error) {
      errors.push(relatedType.error);
    }

    if (dueDate.value && dueDate.value < today) {
      warnings.push(`Échéance ${dueDate.value} déjà passée : la tâche naîtra en retard.`);
    }

    let assigneeUserId: string | null = null;
    if (email.value && email.errors.length === 0) {
      const member = members.get(email.value);
      if (!member) {
        errors.push(`Assigné ${email.value} : aucun membre de l'espace ne porte cette adresse.`);
      } else {
        assigneeUserId = member.id;
      }
    }

    let relatedEntityId: string | null = null;
    if (relatedType.value && reference.value) {
      const found = documents[relatedType.value].get(documentKey(reference.value));
      if (!found) {
        errors.push(
          `${TASK_RELATED_LABELS[relatedType.value]} ${reference.value} : document introuvable dans cet espace.`,
        );
      } else {
        relatedEntityId = found;
      }
    } else if (relatedType.value && !reference.value) {
      errors.push("Référence du document : obligatoire quand le type est renseigné.");
    } else if (!relatedType.value && reference.value) {
      errors.push("Type de document : obligatoire quand la référence est renseignée.");
    }

    if (title.value && openTitles.has(titleKey(title.value))) {
      warnings.push(
        `Une tâche ouverte porte déjà le titre « ${title.value} » : un doublon sera créé.`,
      );
    }

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: null,
      errors,
      warnings,
      data: {
        title: title.value ?? "",
        description: description.value,
        priority: priority.value ?? "normal",
        dueDate: dueDate.value,
        assigneeUserId,
        assigneeEmail: email.value,
        relatedEntityType: relatedType.value,
        relatedEntityId,
        documentReference: reference.value,
      } satisfies TaskImportData,
    };
  });

  for (const row of validated) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
  };
}
