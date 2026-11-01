import type { HrEmployeeStatus } from "@/db/schema";
import { parseIsoDate } from "@/modules/shared/validation";
import type {
  RawImportRow,
  ValidatedRow,
  ValidationResult,
  ValidationContext,
} from "@/modules/catalog/validation";
import {
  HR_EMPLOYEE_STATUS_LABELS,
  MAX_PERSON_NAME_LENGTH,
  MAX_POSITION_LENGTH,
} from "./constants";
import { normalizeEmployeeCode } from "./validation";

export interface HrDepartmentReference {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
}

export interface HrEmployeeReference {
  readonly id: string;
  readonly code: string;
  readonly status: HrEmployeeStatus;
  readonly departureDate: string | null;
}

export interface HrMemberReference {
  readonly id: string;
  readonly name: string;
}

export interface HrEmployeeImportData {
  code: string;
  lastName: string;
  firstName: string;
  position: string | null;
  hireDate: string;
  status: HrEmployeeStatus;
  departureDate: string | null;
  departmentId: string | null;
  managerEmployeeId: string | null;
  userId: string | null;
  employeeId: string | null;
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function labelOf(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\u00a0\u202f]/g, "");
}

const STATUS_BY_LABEL: ReadonlyMap<string, HrEmployeeStatus> = new Map(
  (["active", "suspended", "left"] as const).map((status) => [
    labelOf(HR_EMPLOYEE_STATUS_LABELS[status]),
    status,
  ]),
);

function statusField(raw: unknown): {
  value: HrEmployeeStatus | null;
  errors: string[];
} {
  const text = textOf(raw);
  if (!text) {
    return { value: null, errors: [] };
  }
  const status = STATUS_BY_LABEL.get(labelOf(text));
  if (!status) {
    return {
      value: null,
      errors: [`Statut « ${text} » inconnu : Actif, Suspendu ou Sorti attendu.`],
    };
  }
  return { value: status, errors: [] };
}

function personNameField(
  raw: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): {
  value: string | null;
  errors: string[];
  warnings: string[];
} {
  const rawText = raw === null || raw === undefined ? "" : String(raw);
  const value = rawText.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value) {
    if (required) {
      errors.push(`${label} : obligatoire.`);
    }
    return { value: null, errors, warnings };
  }
  if (value.length > maxLength) {
    errors.push(`${label} : ${maxLength} caractères maximum.`);
  }
  if (value !== rawText) {
    warnings.push(`${label} : espaces de début ou de fin retirés.`);
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
  if (!trimmed) {
    return { value: null, errors: [], warnings: [] };
  }
  const value = trimmed.toLowerCase();
  const warnings: string[] = [];
  if (trimmed !== rawText) {
    warnings.push("Compte (e-mail) : espaces de début ou de fin retirés.");
  }
  if (value !== trimmed) {
    warnings.push("Compte (e-mail) : normalisé en minuscules.");
  }
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return { value: null, errors: ["Compte (e-mail) : adresse invalide."], warnings };
  }
  return { value, errors: [], warnings };
}

export function departmentKey(raw: unknown): string {
  return textOf(raw)
    .replace(/[\s\u00a0\u202f]/g, "")
    .toUpperCase();
}

export function validateHrEmployeeImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
): ValidationResult {
  const departments = context.hrDepartmentsByCode ?? new Map<string, HrDepartmentReference>();
  const employees = context.hrEmployeesByCode ?? new Map<string, HrEmployeeReference>();
  const members = context.hrMembersByEmail ?? new Map<string, HrMemberReference>();
  const userOwners = context.hrLinkedUserIds ?? new Map<string, string>();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const code = normalizeEmployeeCode(row.values["matricule"]);
    errors.push(...code.errors);
    warnings.push(...code.warnings);

    const lastName = personNameField(row.values["nom"], "Nom", MAX_PERSON_NAME_LENGTH, true);
    const firstName = personNameField(row.values["prenom"], "Prénom", MAX_PERSON_NAME_LENGTH, true);
    const positionField = personNameField(row.values["poste"], "Poste", MAX_POSITION_LENGTH, false);
    errors.push(...lastName.errors, ...firstName.errors, ...positionField.errors);
    warnings.push(...lastName.warnings, ...firstName.warnings, ...positionField.warnings);

    const hireDate = parseIsoDate(row.values["date_embauche"], "Date d'embauche", true);
    errors.push(...hireDate.errors);
    warnings.push(...hireDate.warnings);

    const existing = code.value ? (employees.get(code.value) ?? null) : null;
    const status = statusField(row.values["statut"]);
    errors.push(...status.errors);
    let employeeStatus: HrEmployeeStatus = status.value ?? existing?.status ?? "active";
    if (!status.value) {
      warnings.push(
        `Statut : vide, « ${HR_EMPLOYEE_STATUS_LABELS[employeeStatus]} » ${existing ? "conservé" : "retenu"}.`,
      );
    }

    const departmentText = departmentKey(row.values["code_service"]);
    let departmentId: string | null = null;
    if (departmentText) {
      const department = departments.get(departmentText);
      if (!department) {
        errors.push(`Service ${departmentText} : code inconnu dans cet espace.`);
      } else {
        departmentId = department.id;
        if (!department.active) {
          errors.push(`Service ${departmentText} : inactif, réactivez-le avant l'import.`);
        }
      }
    }

    const managerText = departmentKey(row.values["matricule_manager"]);
    let managerEmployeeId: string | null = null;
    if (managerText) {
      const manager = employees.get(managerText);
      if (!manager) {
        errors.push(`Manager ${managerText} : matricule inconnu dans cet espace.`);
      } else if (code.value && manager.code === code.value) {
        errors.push("Manager : un salarié ne peut pas être son propre manager.");
      } else if (manager.status === "left") {
        errors.push(`Manager ${managerText} : ce salarié est sorti de l'effectif.`);
      } else {
        managerEmployeeId = manager.id;
      }
    }

    const email = emailField(row.values["compte_email"]);
    errors.push(...email.errors);
    warnings.push(...email.warnings);

    let userId: string | null = null;
    if (email.value) {
      const member = members.get(email.value);
      if (!member) {
        errors.push(`Compte ${email.value} : aucun membre de l'espace ne porte cette adresse.`);
      } else {
        userId = member.id;
        if (existing) {
          const owner = userOwners.get(existing.id);
          if (owner && owner !== member.id) {
            errors.push(
              `Compte ${email.value} : ce compte est déjà rattaché à une autre fiche salarié de l'espace.`,
            );
          }
        } else if ([...userOwners.values()].some((owner) => owner === member.id)) {
          errors.push(
            `Compte ${email.value} : déjà rattaché à une autre fiche salarié de l'espace.`,
          );
        }
      }
    }

    let departureDate: string | null = null;
    if (employeeStatus === "left") {
      if (existing?.departureDate) {
        departureDate = existing.departureDate;
        if (status.value === "left") {
          warnings.push(
            `Statut « Sorti » : la date de sortie existante ${existing.departureDate} est conservée.`,
          );
        }
      } else {
        errors.push(
          "Statut « Sorti » : le fichier ne porte pas de date de sortie ; enregistrez-la sur la fiche salarié.",
        );
      }
    } else if (existing?.status === "left") {
      employeeStatus = "left";
      departureDate = existing.departureDate;
      warnings.push(`La fiche ${existing.code} est déjà sortie : l'import ne la réactive pas.`);
    }
    if (departureDate && hireDate.value && departureDate <= hireDate.value) {
      errors.push("Date de sortie : doit rester postérieure à la date d'embauche.");
    }

    if (existing) {
      warnings.push(
        `Matricule ${existing.code} déjà présent : la fiche est mise à jour, non dupliquée.`,
      );
    }

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: code.value,
      errors,
      warnings,
      data: {
        code: code.value ?? "",
        lastName: lastName.value ?? "",
        firstName: firstName.value ?? "",
        position: positionField.value,
        hireDate: hireDate.value ?? "",
        status: employeeStatus,
        departureDate,
        departmentId,
        managerEmployeeId,
        userId,
        employeeId: existing?.id ?? null,
      } satisfies HrEmployeeImportData,
    };
  });

  const seen = new Map<string, number[]>();
  for (const row of validated) {
    const code = typeof row.data.code === "string" ? row.data.code : "";
    if (!code) {
      continue;
    }
    const lines = seen.get(code) ?? [];
    lines.push(row.rowNumber);
    seen.set(code, lines);
  }
  for (const [code, lines] of seen) {
    if (lines.length < 2) {
      continue;
    }
    for (const row of validated) {
      if (row.data.code === code) {
        row.errors.push(
          `Matricule ${code} : présent plusieurs fois dans le fichier (lignes ${lines.join(", ")}).`,
        );
      }
    }
  }

  const accounts = new Map<string, number[]>();
  for (const row of validated) {
    const userId = row.data.userId;
    if (typeof userId !== "string" || !userId) {
      continue;
    }
    const lines = accounts.get(userId) ?? [];
    lines.push(row.rowNumber);
    accounts.set(userId, lines);
  }
  for (const lines of accounts.values()) {
    if (lines.length < 2) {
      continue;
    }
    for (const row of validated) {
      if (row.data.userId && lines.includes(row.rowNumber)) {
        row.errors.push(
          `Compte rattaché : la même adresse vise plusieurs lignes (lignes ${lines.join(", ")}).`,
        );
      }
    }
  }

  for (const row of validated) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }

  const notes: string[] = [];
  const applicable = validated.filter((row) => row.errors.length === 0);
  if (applicable.length > 0) {
    const created = applicable.filter((row) => !row.data.employeeId).length;
    const updated = applicable.length - created;
    notes.push(
      `${applicable.length} fiche${applicable.length > 1 ? "s" : ""} ${
        applicable.length > 1 ? "seront" : "sera"
      } écrite${applicable.length > 1 ? "s" : ""} à la confirmation : ${created} création(s), ${updated} mise(s à jour).`,
    );
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}
