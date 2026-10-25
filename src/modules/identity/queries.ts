import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, memberships, sessions, tenants, users } from "@/db/schema";
import type { Role } from "./permissions";

export interface MembershipSummary {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly role: Role;
  readonly createdAt: Date;
}

export interface SessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly userName: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly role: Role;
}

export interface LoginAccount {
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  readonly passwordHash: string;
  readonly memberships: readonly { tenantId: string; role: Role; createdAt: Date }[];
}

export interface AuditEventRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: Date;
  readonly actorName: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findLoginAccount(db: Database, email: string): Promise<LoginAccount | null> {
  const [user] = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  if (!user) {
    return null;
  }

  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .where(eq(memberships.userId, user.userId));

  return { ...user, memberships: rows };
}

export async function resolveSession(
  db: Database,
  tokenHash: string,
): Promise<SessionContext | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(
      memberships,
      and(eq(memberships.userId, sessions.userId), eq(memberships.tenantId, sessions.tenantId)),
    )
    .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);

  return row ?? null;
}

export async function startSession(
  db: Database,
  input: { userId: string; tenantId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        tenantId: input.tenantId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning({ id: sessions.id });

    if (!created) {
      throw new Error("Session non créée.");
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: "auth.login",
      entityType: "session",
      entityId: created.id,
    });
  });
}

export async function endSession(db: Database, tokenHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .returning({ id: sessions.id, tenantId: sessions.tenantId, userId: sessions.userId });

    if (!removed) {
      return;
    }

    await tx.insert(auditEvents).values({
      tenantId: removed.tenantId,
      actorUserId: removed.userId,
      action: "auth.logout",
      entityType: "session",
      entityId: removed.id,
    });
  });
}

export async function listMembershipsForUser(
  db: Database,
  userId: string,
): Promise<readonly MembershipSummary[]> {
  return db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(tenants.name);
}

export async function findMembership(
  db: Database,
  input: { userId: string; tenantId: string },
): Promise<Role | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, input.userId), eq(memberships.tenantId, input.tenantId)))
    .limit(1);

  return row?.role ?? null;
}

export async function switchSessionTenant(
  db: Database,
  input: { sessionId: string; userId: string; tenantId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, input.userId), eq(memberships.tenantId, input.tenantId)))
      .limit(1);

    if (!membership) {
      return false;
    }

    const [current] = await tx
      .select({ tenantId: sessions.tenantId })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)))
      .limit(1);

    if (!current) {
      return false;
    }

    const [updated] = await tx
      .update(sessions)
      .set({ tenantId: input.tenantId })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)))
      .returning({ id: sessions.id });

    if (!updated) {
      return false;
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: "tenant.switch",
      entityType: "session",
      entityId: updated.id,
      details: { fromTenantId: current.tenantId, toTenantId: input.tenantId },
    });

    return true;
  });
}

export async function listAuditEvents(
  db: Database,
  input: { tenantId: string; limit?: number },
): Promise<readonly AuditEventRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      details: auditEvents.details,
      createdAt: auditEvents.createdAt,
      actorName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(eq(auditEvents.tenantId, input.tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
