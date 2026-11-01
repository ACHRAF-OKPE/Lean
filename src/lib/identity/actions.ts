"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import type { TeamFormState } from "@/lib/identity/form-state";
import { LEVELS, type Level, MODULE_KEYS, type ModuleKey } from "@/modules/identity/modules";
import { MIN_PASSWORD_LENGTH } from "@/modules/identity/password";
import { isRole, type Role } from "@/modules/identity/permissions";
import {
  addTeamMember,
  parseLevel,
  parseModule,
  removeTeamMember,
  saveMemberLevels,
  setMemberRole,
  setModuleResponsible,
} from "@/modules/identity/team";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown): TeamFormState {
  if (error instanceof Error) {
    return { errors: [error.message] };
  }
  throw error;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function memberId(formData: FormData): string {
  const value = text(formData, "targetUserId");
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Membre invalide.");
  }
  return value;
}

function roleOf(formData: FormData): Role {
  const value = text(formData, "role");
  if (!isRole(value)) {
    throw new Error("Rôle inconnu.");
  }
  return value;
}

export async function addMemberAction(
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const session = await requirePermission("members.manage");
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      errors: [
        `Le mot de passe temporaire doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      ],
    };
  }

  try {
    await addTeamMember(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      name: text(formData, "name"),
      email: text(formData, "email"),
      password,
      role: roleOf(formData),
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/equipe");
  redirect("/equipe?membre=ajoute");
}

export async function setRoleAction(
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const session = await requirePermission("members.manage");
  let role: Role;
  let targetUserId: string;
  try {
    role = roleOf(formData);
    targetUserId = memberId(formData);
  } catch (error) {
    return failure(error);
  }

  try {
    await setMemberRole(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
      role,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/equipe");
  redirect("/equipe?role=enregistre");
}

export async function saveLevelsAction(
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const session = await requirePermission("members.manage");
  let targetUserId: string;
  const levels = {} as Record<ModuleKey, Level | null>;

  try {
    targetUserId = memberId(formData);
    for (const key of MODULE_KEYS) {
      const value = text(formData, `droit:${key}`);
      if (value !== "" && !LEVELS.includes(value as Level)) {
        throw new Error("Niveau de droit inconnu.");
      }
      levels[key] = value === "" ? null : parseLevel(value);
    }
  } catch (error) {
    return failure(error);
  }

  let changed = 0;
  try {
    changed = await saveMemberLevels(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
      levels,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/equipe");
  redirect(`/equipe?droits=${changed === 0 ? "inchanges" : "enregistres"}`);
}

export async function setResponsibleAction(
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const session = await requirePermission("members.manage");
  let moduleKey: ModuleKey;
  let targetUserId: string | null;

  try {
    moduleKey = parseModule(text(formData, "module"));
    const value = text(formData, "responsibleUserId");
    if (value !== "" && !UUID_PATTERN.test(value)) {
      throw new Error("Membre invalide.");
    }
    targetUserId = value === "" ? null : value;
  } catch (error) {
    return failure(error);
  }

  try {
    await setModuleResponsible(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      module: moduleKey,
      targetUserId,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/equipe");
  redirect("/equipe?responsable=enregistre");
}

export async function removeMemberAction(
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const session = await requirePermission("members.manage");
  let targetUserId: string;
  try {
    targetUserId = memberId(formData);
  } catch (error) {
    return failure(error);
  }

  try {
    await removeTeamMember(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/equipe");
  redirect("/equipe?membre=retire");
}
