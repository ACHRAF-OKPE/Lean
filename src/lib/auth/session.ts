import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { atLeast, type ModuleKey, type RequiredLevel } from "@/modules/identity/modules";
import { can, type Permission } from "@/modules/identity/permissions";
import { resolveSession, type SessionContext } from "@/modules/identity/queries";
import { getMemberLevels } from "@/modules/identity/team";
import { hashSessionToken, isSessionToken } from "@/modules/identity/tokens";
import { readSessionToken } from "./cookies";

export const getSession = cache(async (): Promise<SessionContext | null> => {
  const token = await readSessionToken();
  if (!token || !isSessionToken(token)) {
    return null;
  }
  return resolveSession(getDb(), hashSessionToken(token));
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) {
    redirect("/connexion");
  }
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.role, permission)) {
    redirect("/acces-refuse");
  }
  return session;
}

export const getAccessLevels = cache(async (session: SessionContext) =>
  getMemberLevels(getDb(), session.tenantId, session.userId, session.role),
);

export async function canAccessModule(
  session: SessionContext,
  module: ModuleKey,
  level: RequiredLevel,
): Promise<boolean> {
  if (!can(session.role, level === "read" ? "data.read" : "data.write")) {
    return false;
  }
  const access = await getAccessLevels(session);
  return atLeast(access[module], level);
}

export async function requireModule(
  module: ModuleKey,
  level: RequiredLevel,
): Promise<SessionContext> {
  const session = await requirePermission(level === "read" ? "data.read" : "data.write");
  if (!(await canAccessModule(session, module, level))) {
    redirect("/acces-refuse");
  }
  return session;
}
