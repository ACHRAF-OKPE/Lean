import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can, type Permission } from "@/modules/identity/permissions";
import { resolveSession, type SessionContext } from "@/modules/identity/queries";
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
