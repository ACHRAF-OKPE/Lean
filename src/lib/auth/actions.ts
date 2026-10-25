"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { verifyPassword } from "@/modules/identity/password";
import { selectDefaultMembership } from "@/modules/identity/permissions";
import {
  endSession,
  findLoginAccount,
  normalizeEmail,
  startSession,
  switchSessionTenant,
} from "@/modules/identity/queries";
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  SESSION_TTL_MS,
} from "@/modules/identity/tokens";
import { clearSessionCookie, readSessionToken, writeSessionCookie } from "./cookies";
import { requireSession } from "./session";
import type { LoginState } from "./types";

const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$vgTqINrG02ywyj6Z4byCuA$z532ZEmCe972Pld7VHgPEs0IQTkLqnPbwNiknpjHPQxDYkrsvDUNUUbp7gW-NI5LL6Mkyd1t5aEwp2kz4cVgmA";

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Renseignez l'adresse e-mail et le mot de passe." };
  }

  const db = getDb();
  const account = await findLoginAccount(db, email);
  const passwordMatches = await verifyPassword(
    password,
    account?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!account || !passwordMatches) {
    return { error: "Adresse e-mail ou mot de passe incorrect." };
  }

  const membership = selectDefaultMembership(account.memberships);
  if (!membership) {
    return { error: "Aucun espace de travail n'est rattaché à ce compte." };
  }

  const { token, tokenHash } = createSessionToken();
  await startSession(db, {
    userId: account.userId,
    tenantId: membership.tenantId,
    tokenHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await writeSessionCookie(token);

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token && isSessionToken(token)) {
    await endSession(getDb(), hashSessionToken(token));
  }
  await clearSessionCookie();
  redirect("/connexion");
}

export async function switchTenantAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = String(formData.get("tenantId") ?? "");

  if (tenantId && tenantId !== session.tenantId) {
    const switched = await switchSessionTenant(getDb(), {
      sessionId: session.sessionId,
      userId: session.userId,
      tenantId,
    });
    if (!switched) {
      redirect("/acces-refuse");
    }
  }

  redirect("/");
}
