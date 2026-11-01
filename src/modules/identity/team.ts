import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, memberships, moduleGrants, moduleResponsibles, users } from "@/db/schema";
import { hashPassword } from "./password";
import {
  isLevel,
  isModuleKey,
  type Level,
  type ModuleKey,
  MODULE_KEYS,
  resolveLevels,
} from "./modules";
import { normalizeEmail } from "./queries";
import { type Role } from "./permissions";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbLike = Database | Transaction;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TeamMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly joinedAt: Date;
  readonly levels: Record<ModuleKey, Level>;
  readonly grants: Partial<Record<ModuleKey, Level>>;
  readonly responsibleOf: readonly ModuleKey[];
}

export interface TeamView {
  readonly members: readonly TeamMember[];
  readonly responsibles: readonly { module: ModuleKey; userId: string; name: string }[];
}

export interface AuditInput {
  readonly tenantId: string;
  readonly actorUserId: string;
}

async function requireMembership(
  db: DbLike,
  tenantId: string,
  userId: string,
  label: string,
): Promise<Role> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) {
    throw new Error(`${label} : ce compte n'est pas membre de cet espace.`);
  }
  return row.role;
}

async function countOwners(db: DbLike, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")));
  return Number(row?.total ?? 0);
}

function guardSelfManagement(input: AuditInput, targetUserId: string, message: string): void {
  if (input.actorUserId === targetUserId) {
    throw new Error(message);
  }
}

export async function getMemberLevels(
  db: Database,
  tenantId: string,
  userId: string,
  role: Role,
): Promise<Record<ModuleKey, Level>> {
  const grants = await listMemberGrants(db, { tenantId, userId });
  return resolveLevels(role, grants);
}

export async function listTeam(db: Database, tenantId: string): Promise<TeamView> {
  const [memberRows, grantRows, responsibleRows] = await Promise.all([
    db
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenantId))
      .orderBy(asc(users.name)),
    db
      .select({
        userId: moduleGrants.userId,
        module: moduleGrants.module,
        level: moduleGrants.level,
      })
      .from(moduleGrants)
      .where(eq(moduleGrants.tenantId, tenantId)),
    db
      .select({ module: moduleResponsibles.module, userId: moduleResponsibles.userId })
      .from(moduleResponsibles)
      .where(eq(moduleResponsibles.tenantId, tenantId)),
  ]);

  const grantsByUser = new Map<string, Partial<Record<ModuleKey, Level>>>();
  for (const row of grantRows) {
    const current = grantsByUser.get(row.userId) ?? {};
    current[row.module] = row.level;
    grantsByUser.set(row.userId, current);
  }

  const responsibleByUser = new Map<string, ModuleKey[]>();
  for (const row of responsibleRows) {
    const current = responsibleByUser.get(row.userId) ?? [];
    current.push(row.module);
    responsibleByUser.set(row.userId, current);
  }

  const nameByUser = new Map(memberRows.map((row) => [row.userId, row.name]));

  return {
    members: memberRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.joinedAt,
      levels: resolveLevels(row.role, grantsByUser.get(row.userId) ?? {}),
      grants: grantsByUser.get(row.userId) ?? {},
      responsibleOf: responsibleByUser.get(row.userId) ?? [],
    })),
    responsibles: responsibleRows
      .map((row) => ({
        module: row.module,
        userId: row.userId,
        name: nameByUser.get(row.userId) ?? "—",
      }))
      .sort((a, b) => a.module.localeCompare(b.module, "fr")),
  };
}

export async function addTeamMember(
  db: Database,
  input: AuditInput & {
    name: string;
    email: string;
    password: string;
    role: Role;
  },
): Promise<{ userId: string; membershipCreated: boolean }> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (name.length < 2 || name.length > 120) {
    throw new Error("Le nom du membre doit contenir entre 2 et 120 caractères.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("L'adresse e-mail est invalide.");
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const known = existing?.id ?? null;
  if (known) {
    const [member] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, known)))
      .limit(1);
    if (member) {
      throw new Error("Ce compte est déjà membre de cet espace.");
    }
  }

  const passwordHash = await hashPassword(input.password);
  const actorRole = await requireMembership(db, input.tenantId, input.actorUserId, "Ajout");
  if (input.role === "owner" && actorRole !== "owner") {
    throw new Error("Seul le propriétaire peut nommer un propriétaire.");
  }

  return db.transaction(async (tx) => {
    const userId = known ?? (await createAccount(tx, name, email, passwordHash));

    await tx
      .insert(memberships)
      .values({ tenantId: input.tenantId, userId, role: input.role })
      .onConflictDoNothing();

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: known ? "identity.member.join" : "identity.member.create",
      entityType: "membership",
      entityId: userId,
      details: { email, role: input.role, accountCreated: !known },
    });

    return { userId, membershipCreated: true };
  });
}

async function createAccount(
  tx: DbLike,
  name: string,
  email: string,
  passwordHash: string,
): Promise<string> {
  const [created] = await tx
    .insert(users)
    .values({ name, email, passwordHash })
    .returning({ id: users.id });
  if (!created) {
    throw new Error("Le compte n'a pas pu être créé.");
  }
  return created.id;
}

export async function setMemberRole(
  db: Database,
  input: AuditInput & { targetUserId: string; role: Role },
): Promise<void> {
  const current = await requireMembership(db, input.tenantId, input.targetUserId, "Rôle");
  guardSelfManagement(input, input.targetUserId, "Vous ne pouvez pas changer votre propre rôle.");

  const actorRole = await requireMembership(db, input.tenantId, input.actorUserId, "Rôle");
  if (input.role === "owner" && actorRole !== "owner") {
    throw new Error("Seul le propriétaire peut nommer un propriétaire.");
  }
  if (current === "owner" && actorRole !== "owner") {
    throw new Error("Seul le propriétaire peut démettre un propriétaire.");
  }
  if (
    current === "owner" &&
    input.role !== "owner" &&
    (await countOwners(db, input.tenantId)) <= 1
  ) {
    throw new Error("L'espace doit conserver au moins un propriétaire.");
  }
  if (current === input.role) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ role: input.role })
      .where(
        and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.targetUserId)),
      );

    await tx
      .delete(moduleGrants)
      .where(
        and(eq(moduleGrants.tenantId, input.tenantId), eq(moduleGrants.userId, input.targetUserId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "identity.member.role",
      entityType: "membership",
      entityId: input.targetUserId,
      details: { before: current, after: input.role, grantsCleared: true },
    });
  });
}

export function parseLevel(value: string): Level {
  if (!isLevel(value)) {
    throw new Error("Niveau de droit inconnu.");
  }
  return value;
}

export function parseModule(value: string): ModuleKey {
  if (!isModuleKey(value)) {
    throw new Error("Module inconnu.");
  }
  return value;
}

export async function saveModuleGrant(
  db: Database,
  input: AuditInput & { targetUserId: string; module: ModuleKey; level: Level },
): Promise<void> {
  const moduleKey = parseModule(input.module);
  const level = parseLevel(input.level);
  guardSelfManagement(input, input.targetUserId, "Vous ne pouvez pas modifier vos propres droits.");
  const targetRole = await requireMembership(db, input.tenantId, input.targetUserId, "Concession");
  if (targetRole === "owner") {
    throw new Error("Le propriétaire gère tous les modules : une concession est inutile.");
  }

  const [before] = await db
    .select({ level: moduleGrants.level })
    .from(moduleGrants)
    .where(
      and(
        eq(moduleGrants.tenantId, input.tenantId),
        eq(moduleGrants.userId, input.targetUserId),
        eq(moduleGrants.module, moduleKey),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .insert(moduleGrants)
      .values({
        tenantId: input.tenantId,
        userId: input.targetUserId,
        module: moduleKey,
        level,
        grantedByUserId: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: [moduleGrants.tenantId, moduleGrants.userId, moduleGrants.module],
        set: { level, grantedByUserId: input.actorUserId, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "identity.grant.save",
      entityType: "module_grant",
      entityId: input.targetUserId,
      details: { module: moduleKey, before: before?.level ?? null, after: level },
    });
  });
}

export async function removeModuleGrant(
  db: Database,
  input: AuditInput & { targetUserId: string; module: ModuleKey },
): Promise<void> {
  const moduleKey = parseModule(input.module);
  guardSelfManagement(input, input.targetUserId, "Vous ne pouvez pas modifier vos propres droits.");
  await requireMembership(db, input.tenantId, input.targetUserId, "Concession");

  const [before] = await db
    .select({ level: moduleGrants.level })
    .from(moduleGrants)
    .where(
      and(
        eq(moduleGrants.tenantId, input.tenantId),
        eq(moduleGrants.userId, input.targetUserId),
        eq(moduleGrants.module, moduleKey),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .delete(moduleGrants)
      .where(
        and(
          eq(moduleGrants.tenantId, input.tenantId),
          eq(moduleGrants.userId, input.targetUserId),
          eq(moduleGrants.module, moduleKey),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "identity.grant.remove",
      entityType: "module_grant",
      entityId: input.targetUserId,
      details: { module: moduleKey, before: before?.level ?? null, after: null },
    });
  });
}

export async function listMemberGrants(
  db: Database,
  input: { tenantId: string; userId: string },
): Promise<Partial<Record<ModuleKey, Level>>> {
  const rows = await db
    .select({ module: moduleGrants.module, level: moduleGrants.level })
    .from(moduleGrants)
    .where(and(eq(moduleGrants.tenantId, input.tenantId), eq(moduleGrants.userId, input.userId)));

  const grants: Partial<Record<ModuleKey, Level>> = {};
  for (const row of rows) {
    grants[row.module] = row.level;
  }
  return grants;
}

/** Un seul enregistrement pour toute la matrice : seules les concessions réellement changées écrivent. */
export async function saveMemberLevels(
  db: Database,
  input: AuditInput & {
    targetUserId: string;
    levels: Record<ModuleKey, Level | null>;
  },
): Promise<number> {
  guardSelfManagement(input, input.targetUserId, "Vous ne pouvez pas modifier vos propres droits.");
  const targetRole = await requireMembership(
    db,
    input.tenantId,
    input.targetUserId,
    "Matrice des droits",
  );
  if (targetRole === "owner") {
    throw new Error("Le propriétaire gère tous les modules : une concession est inutile.");
  }

  const current = await listMemberGrants(db, {
    tenantId: input.tenantId,
    userId: input.targetUserId,
  });

  const changes = MODULE_KEYS.map((moduleKey) => ({
    module: moduleKey,
    before: current[moduleKey] ?? null,
    after: input.levels[moduleKey],
  })).filter((change) => change.before !== change.after);

  if (changes.length === 0) {
    return 0;
  }

  await db.transaction(async (tx) => {
    for (const change of changes) {
      if (change.after === null) {
        await tx
          .delete(moduleGrants)
          .where(
            and(
              eq(moduleGrants.tenantId, input.tenantId),
              eq(moduleGrants.userId, input.targetUserId),
              eq(moduleGrants.module, change.module),
            ),
          );
      } else {
        await tx
          .insert(moduleGrants)
          .values({
            tenantId: input.tenantId,
            userId: input.targetUserId,
            module: change.module,
            level: change.after,
            grantedByUserId: input.actorUserId,
          })
          .onConflictDoUpdate({
            target: [moduleGrants.tenantId, moduleGrants.userId, moduleGrants.module],
            set: {
              level: change.after,
              grantedByUserId: input.actorUserId,
              updatedAt: new Date(),
            },
          });
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: change.after === null ? "identity.grant.remove" : "identity.grant.save",
        entityType: "module_grant",
        entityId: input.targetUserId,
        details: { module: change.module, before: change.before, after: change.after },
      });
    }
  });

  return changes.length;
}

export async function setModuleResponsible(
  db: Database,
  input: AuditInput & { module: ModuleKey; targetUserId: string | null },
): Promise<void> {
  const moduleKey = parseModule(input.module);
  if (input.targetUserId) {
    await requireMembership(db, input.tenantId, input.targetUserId, "Responsable");
  }

  const [before] = await db
    .select({ userId: moduleResponsibles.userId })
    .from(moduleResponsibles)
    .where(
      and(
        eq(moduleResponsibles.tenantId, input.tenantId),
        eq(moduleResponsibles.module, moduleKey),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    if (!input.targetUserId) {
      await tx
        .delete(moduleResponsibles)
        .where(
          and(
            eq(moduleResponsibles.tenantId, input.tenantId),
            eq(moduleResponsibles.module, moduleKey),
          ),
        );
    } else {
      await tx
        .insert(moduleResponsibles)
        .values({
          tenantId: input.tenantId,
          module: moduleKey,
          userId: input.targetUserId,
          assignedByUserId: input.actorUserId,
        })
        .onConflictDoUpdate({
          target: [moduleResponsibles.tenantId, moduleResponsibles.module],
          set: {
            userId: input.targetUserId,
            assignedByUserId: input.actorUserId,
            updatedAt: new Date(),
          },
        });
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "identity.responsible.set",
      entityType: "module_responsible",
      entityId: moduleKey,
      details: { module: moduleKey, before: before?.userId ?? null, after: input.targetUserId },
    });
  });
}

export async function removeTeamMember(
  db: Database,
  input: AuditInput & { targetUserId: string },
): Promise<void> {
  const current = await requireMembership(db, input.tenantId, input.targetUserId, "Retrait");
  guardSelfManagement(
    input,
    input.targetUserId,
    "Vous ne pouvez pas vous retirer vous-même de l'espace.",
  );
  if (current === "owner" && (await countOwners(db, input.tenantId)) <= 1) {
    throw new Error("L'espace doit conserver au moins un propriétaire.");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(memberships)
      .where(
        and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.targetUserId)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "identity.member.remove",
      entityType: "membership",
      entityId: input.targetUserId,
      details: { role: current },
    });
  });
}
