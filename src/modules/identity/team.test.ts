import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  memberships,
  moduleGrants,
  moduleResponsibles,
  tenants,
  users,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import type { Level, ModuleKey } from "./modules";
import { MODULE_KEYS } from "./modules";
import { hashPassword } from "./password";
import type { Role } from "./permissions";
import {
  addTeamMember,
  getMemberLevels,
  listTeam,
  parseLevel,
  parseModule,
  removeModuleGrant,
  removeTeamMember,
  saveMemberLevels,
  saveModuleGrant,
  setMemberRole,
  setModuleResponsible,
} from "./team";

let context: TestDatabase;
let db: Database;
let tenantId: string;
let otherTenantId: string;
let ownerId: string;
let passwordHash: string;

async function makeUser(email: string, name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("Compte non créé.");
  }
  return row.id;
}

async function makeMember(email: string, name: string, role: Role): Promise<string> {
  const userId = await makeUser(email, name);
  await db.insert(memberships).values({ tenantId, userId, role });
  return userId;
}

async function makeTenant(slug: string): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug, name: `Espace ${slug}` })
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Espace non créé.");
  }
  return row.id;
}

async function grant(userId: string, module: ModuleKey, level: Level): Promise<void> {
  await db
    .insert(moduleGrants)
    .values({ tenantId, userId, module, level, grantedByUserId: ownerId })
    .onConflictDoUpdate({
      target: [moduleGrants.tenantId, moduleGrants.userId, moduleGrants.module],
      set: { level },
    });
}

function levelOf(userId: string, module: ModuleKey, role: Role): Promise<Level> {
  return getMemberLevels(db, tenantId, userId, role).then((levels) => levels[module]);
}

async function audits(action: string, entityId?: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select({ details: auditEvents.details })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, action),
        ...(entityId ? [eq(auditEvents.entityId, entityId)] : []),
      ),
    )
    .orderBy(desc(auditEvents.createdAt));
  return rows.map((row) => row.details);
}

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  passwordHash = await hashPassword("mot-de-passe-solide");
  tenantId = await makeTenant("droits");
  otherTenantId = await makeTenant("droits-voisin");
  ownerId = await makeUser("proprio@example.com", "Propriétaire");
  await db.insert(memberships).values({ tenantId, userId: ownerId, role: "owner" });
});

afterAll(async () => {
  await context.close();
});

describe("TEN-009 — concession explicite, défaut du rôle et propriétaire", () => {
  it("élève un membre sur un module scellé sans toucher aux autres modules", async () => {
    const userId = await makeMember("comptable@example.com", "Awa Comptable", "member");
    await saveModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "accounting",
      level: "write",
    });

    expect(await levelOf(userId, "accounting", "member")).toBe("write");
    expect(await levelOf(userId, "customs", "member")).toBe("none");
    expect(await levelOf(userId, "sales", "member")).toBe("read");
  });

  it("scelle explicitement un module pourtant ouvert par défaut", async () => {
    const userId = await makeMember("magasin@example.com", "Karl Magasin", "member");
    await saveModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "stock",
      level: "none",
    });

    expect(await levelOf(userId, "stock", "member")).toBe("none");
    const rows = await db
      .select({ id: moduleGrants.id })
      .from(moduleGrants)
      .where(and(eq(moduleGrants.userId, userId), eq(moduleGrants.module, "stock")));
    expect(rows).toHaveLength(1);
  });

  it("fait retomber au défaut du rôle quand la concession est retirée", async () => {
    const userId = await makeMember("retirable@example.com", "Remy Retirable", "member");
    await saveModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "accounting",
      level: "read",
    });
    expect(await levelOf(userId, "accounting", "member")).toBe("read");

    await removeModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "accounting",
    });

    expect(await levelOf(userId, "accounting", "member")).toBe("none");
    const rows = await db
      .select({ id: moduleGrants.id })
      .from(moduleGrants)
      .where(and(eq(moduleGrants.userId, userId), eq(moduleGrants.module, "accounting")));
    expect(rows).toHaveLength(0);
    const removed = await audits("identity.grant.remove");
    expect(removed.at(0)).toMatchObject({ module: "accounting", before: "read", after: null });
  });

  it("ignore les concessions du propriétaire", async () => {
    await grant(ownerId, "sales", "read");
    expect(await levelOf(ownerId, "sales", "owner")).toBe("manage");
  });

  it("borne la concession à l'espace : le niveau d'un autre espace reste le défaut", async () => {
    const userId = await makeMember("nomade@example.com", "Ibra Nomade", "member");
    await grant(userId, "accounting", "manage");
    await db.insert(memberships).values({ tenantId: otherTenantId, userId, role: "member" });

    expect(await levelOf(userId, "accounting", "member")).toBe("manage");
    const elsewhere = await db
      .select({ id: moduleGrants.id })
      .from(moduleGrants)
      .where(and(eq(moduleGrants.tenantId, otherTenantId), eq(moduleGrants.userId, userId)));
    expect(elsewhere).toHaveLength(0);
    const levels = await getMemberLevels(db, otherTenantId, userId, "member");
    expect(levels.accounting).toBe("none");
  });

  it("remet toutes les concessions à zéro quand le rôle change", async () => {
    const userId = await makeMember("line@example.com", "Line Double", "member");
    await grant(userId, "accounting", "write");
    await grant(userId, "stock", "manage");

    await setMemberRole(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      role: "admin",
    });

    const left = await db
      .select({ id: moduleGrants.id })
      .from(moduleGrants)
      .where(eq(moduleGrants.userId, userId));
    expect(left).toHaveLength(0);
    expect(await levelOf(userId, "accounting", "admin")).toBe("manage");
  });

  it("refuse un module ou un niveau hors catalogue", async () => {
    const userId = await makeMember("essai@example.com", "Essai", "member");
    await expect(
      saveModuleGrant(db, {
        tenantId,
        actorUserId: ownerId,
        targetUserId: userId,
        module: "inconnu" as ModuleKey,
        level: "manage",
      }),
    ).rejects.toThrow();
    expect(() => parseModule("inconnu")).toThrow("Module inconnu.");
    expect(() => parseLevel("rw")).toThrow("Niveau de droit inconnu.");
    expect(parseModule("payroll")).toBe("payroll");
    expect(parseModule("sales")).toBe("sales");
    expect(parseLevel("write")).toBe("write");
  });

  it("refuse une concession pour un compte qui n'est pas membre de l'espace", async () => {
    const userId = await makeUser("sans-espace@example.com", "Hors Sol");
    await expect(
      saveModuleGrant(db, {
        tenantId,
        actorUserId: ownerId,
        targetUserId: userId,
        module: "sales",
        level: "write",
      }),
    ).rejects.toThrow("n'est pas membre");
  });
});

describe("TEN-010 — gardes d'intégrité de l'équipe", () => {
  it("réserve au propriétaire la nomination d'un nouveau propriétaire", async () => {
    const adminId = await makeMember("admin@example.com", "Admin Local", "admin");
    await expect(
      addTeamMember(db, {
        tenantId,
        actorUserId: adminId,
        name: "Nouveau Propriétaire",
        email: "nouveau-proprio@example.com",
        password: "mot-de-passe-solide",
        role: "owner",
      }),
    ).rejects.toThrow("Seul le propriétaire peut nommer un propriétaire.");

    const created = await addTeamMember(db, {
      tenantId,
      actorUserId: ownerId,
      name: "Second Propriétaire",
      email: "second-proprio@example.com",
      password: "mot-de-passe-solide",
      role: "owner",
    });
    expect(created.membershipCreated).toBe(true);
  });

  it("refuse qu'un membre modifie ses propres droits ou son propre rôle", async () => {
    const adminId = await makeMember("admin2@example.com", "Admin Deux", "admin");
    await expect(
      saveModuleGrant(db, {
        tenantId,
        actorUserId: adminId,
        targetUserId: adminId,
        module: "accounting",
        level: "manage",
      }),
    ).rejects.toThrow("vos propres droits");
    await expect(
      setMemberRole(db, {
        tenantId,
        actorUserId: adminId,
        targetUserId: adminId,
        role: "member",
      }),
    ).rejects.toThrow("votre propre rôle");
  });

  it("refuse de créer un compte déjà membre de l'espace", async () => {
    await makeMember("doublon@example.com", "Doublon", "member");
    await expect(
      addTeamMember(db, {
        tenantId,
        actorUserId: ownerId,
        name: "Doublon",
        email: "doublon@example.com",
        password: "mot-de-passe-solide",
        role: "member",
      }),
    ).rejects.toThrow("déjà membre");
  });

  it("rattache sans recréer de compte un utilisateur déjà connu", async () => {
    const foreignUserId = await makeUser("voisin@example.com", "Voisin Fidèle");
    await db
      .insert(memberships)
      .values({ tenantId: otherTenantId, userId: foreignUserId, role: "member" });

    const result = await addTeamMember(db, {
      tenantId,
      actorUserId: ownerId,
      name: "Voisin Fidèle",
      email: "voisin@example.com",
      password: "mot-de-passe-solide",
      role: "member",
    });

    expect(result.userId).toBe(foreignUserId);
    const [account] = await db
      .select({ total: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.email, "voisin@example.com"));
    expect(Number(account?.total ?? 0)).toBe(1);
  });

  it("conserve au moins un propriétaire et refuse l'auto-retrait", async () => {
    const lastOwner = await makeTenant("dernier");
    const soloId = await makeUser("solo@example.com", "Solo");
    await db.insert(memberships).values({ tenantId: lastOwner, userId: soloId, role: "owner" });
    const helperId = await makeUser("aide@example.com", "Aide");
    await db.insert(memberships).values({ tenantId: lastOwner, userId: helperId, role: "member" });

    await expect(
      removeTeamMember(db, { tenantId: lastOwner, actorUserId: soloId, targetUserId: soloId }),
    ).rejects.toThrow("vous-même");
    await expect(
      removeTeamMember(db, { tenantId: lastOwner, actorUserId: helperId, targetUserId: soloId }),
    ).rejects.toThrow("au moins un propriétaire");
    await expect(
      setMemberRole(db, {
        tenantId: lastOwner,
        actorUserId: helperId,
        targetUserId: soloId,
        role: "member",
      }),
    ).rejects.toThrow("Seul le propriétaire peut démettre un propriétaire.");

    await removeTeamMember(db, {
      tenantId: lastOwner,
      actorUserId: soloId,
      targetUserId: helperId,
    });
    const stillThere = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.tenantId, lastOwner));
    expect(stillThere).toHaveLength(1);
  });

  it("retire un membre et fait disparaître ses concessions et sa responsabilité", async () => {
    const userId = await makeMember("partant@example.com", "Client Partant", "member");
    await grant(userId, "sales", "manage");
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "invoices",
      targetUserId: userId,
    });

    await removeTeamMember(db, { tenantId, actorUserId: ownerId, targetUserId: userId });

    const grants = await db
      .select({ id: moduleGrants.id })
      .from(moduleGrants)
      .where(eq(moduleGrants.userId, userId));
    const responsibilities = await db
      .select({ id: moduleResponsibles.id })
      .from(moduleResponsibles)
      .where(eq(moduleResponsibles.userId, userId));
    expect(grants).toHaveLength(0);
    expect(responsibilities).toHaveLength(0);
  });
});

describe("TEN-011 — responsable de module, désignation sans droit", () => {
  it("désigne un responsable et conserve un seul responsable par module", async () => {
    const first = await makeMember("resp1@example.com", "Premier Responsable", "member");
    const second = await makeMember("resp2@example.com", "Second Responsable", "member");

    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "stock",
      targetUserId: first,
    });
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "stock",
      targetUserId: second,
    });

    const rows = await db
      .select({ userId: moduleResponsibles.userId })
      .from(moduleResponsibles)
      .where(
        and(eq(moduleResponsibles.tenantId, tenantId), eq(moduleResponsibles.module, "stock")),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(second);

    const team = await listTeam(db, tenantId);
    const responsible = team.members.find((member) => member.userId === second);
    expect(responsible?.responsibleOf).toEqual(["stock"]);
  });

  it("ne change aucun niveau de droit par la seule désignation", async () => {
    const userId = await makeMember("resp3@example.com", "Troisième Responsable", "member");
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "customs",
      targetUserId: userId,
    });

    expect(await levelOf(userId, "customs", "member")).toBe("none");
  });

  it("refuse un responsable qui n'est pas membre et permet de retirer la désignation", async () => {
    const outsider = await makeUser("etranger@example.com", "Étranger");
    await expect(
      setModuleResponsible(db, {
        tenantId,
        actorUserId: ownerId,
        module: "sales",
        targetUserId: outsider,
      }),
    ).rejects.toThrow("n'est pas membre");

    const userId = await makeMember("resp4@example.com", "Quatrième Responsable", "member");
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "sales",
      targetUserId: userId,
    });
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "sales",
      targetUserId: null,
    });
    const rows = await db
      .select({ id: moduleResponsibles.id })
      .from(moduleResponsibles)
      .where(
        and(eq(moduleResponsibles.tenantId, tenantId), eq(moduleResponsibles.module, "sales")),
      );
    expect(rows).toHaveLength(0);
  });
});

describe("TEN-012 — audit des mutations d'équipe et de droits", () => {
  it("conserve la valeur avant et après pour chaque mutation", async () => {
    const userId = await makeMember("audite@example.com", "Audité", "member");
    await saveModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "sales",
      level: "write",
    });
    await saveModuleGrant(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      module: "sales",
      level: "manage",
    });
    await setMemberRole(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      role: "admin",
    });
    await setModuleResponsible(db, {
      tenantId,
      actorUserId: ownerId,
      module: "partners",
      targetUserId: userId,
    });

    const grantAudits = await audits("identity.grant.save", userId);
    expect(grantAudits.at(0)).toMatchObject({ module: "sales", before: "write", after: "manage" });
    expect(grantAudits.at(-1)).toMatchObject({ module: "sales", before: null, after: "write" });

    const roleAudits = await audits("identity.member.role", userId);
    expect(roleAudits.at(0)).toMatchObject({ before: "member", after: "admin" });

    const responsibleAudits = await audits("identity.responsible.set", "partners");
    expect(responsibleAudits.at(0)).toMatchObject({ module: "partners", before: null });
  });

  it("trace la création du compte et le retrait du membre", async () => {
    const created = await addTeamMember(db, {
      tenantId,
      actorUserId: ownerId,
      name: "Traceur",
      email: "traceur@example.com",
      password: "mot-de-passe-solide",
      role: "member",
    });
    const createAudits = await audits("identity.member.create", created.userId);
    expect(createAudits.at(0)).toMatchObject({ role: "member", accountCreated: true });

    const team = await listTeam(db, tenantId);
    const traced = team.members.find((member) => member.email === "traceur@example.com");
    if (!traced) {
      throw new Error("Membre attendu dans la liste d'équipe.");
    }
    await removeTeamMember(db, { tenantId, actorUserId: ownerId, targetUserId: traced.userId });
    const removed = await audits("identity.member.remove", traced.userId);
    expect(removed.at(0)).toMatchObject({ role: "member" });
  });

  it("ne liste que les membres et les responsables de l'espace demandé", async () => {
    const team = await listTeam(db, otherTenantId);
    expect(team.members.map((member) => member.email)).toContain("voisin@example.com");
    expect(team.members.some((member) => member.email === "proprio@example.com")).toBe(false);
    expect(team.responsibles).toHaveLength(0);
  });
});

describe("TEN-009 — enregistrement groupé de la matrice des droits", () => {
  function allLevels(
    overrides: Partial<Record<ModuleKey, Level | null>>,
  ): Record<ModuleKey, Level | null> {
    const levels = {} as Record<ModuleKey, Level | null>;
    for (const key of MODULE_KEYS) {
      levels[key] = overrides[key] ?? null;
    }
    return levels;
  }

  it("n'écrit et n'audite que les concessions réellement changées", async () => {
    const userId = await makeMember("matrice@example.com", "Mata Matrice", "member");
    await grant(userId, "stock", "read");

    const changed = await saveMemberLevels(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      levels: allLevels({ stock: "read", accounting: "write", customs: "none" }),
    });

    expect(changed).toBe(2);
    expect(await levelOf(userId, "stock", "member")).toBe("read");
    expect(await levelOf(userId, "accounting", "member")).toBe("write");
    expect(await levelOf(userId, "customs", "member")).toBe("none");
    expect(await levelOf(userId, "sales", "member")).toBe("read");

    const rows = await db
      .select({ module: moduleGrants.module })
      .from(moduleGrants)
      .where(and(eq(moduleGrants.tenantId, tenantId), eq(moduleGrants.userId, userId)));
    expect(rows.map((row) => row.module).sort()).toEqual(["accounting", "customs", "stock"]);

    const saved = await audits("identity.grant.save", userId);
    expect(saved.map((detail) => detail.module).sort()).toEqual(["accounting", "customs"]);
    expect(await audits("identity.grant.remove", userId)).toHaveLength(0);
  });

  it("retombe sur le défaut du rôle pour les modules laissés sans concession", async () => {
    const userId = await makeMember("defaut@example.com", "Diallo Défaut", "member");
    await saveMemberLevels(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      levels: allLevels({ accounting: "manage" }),
    });

    const cleared = await saveMemberLevels(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      levels: allLevels({}),
    });

    expect(cleared).toBe(1);
    expect(await levelOf(userId, "accounting", "member")).toBe("none");
    const removed = await audits("identity.grant.remove", userId);
    expect(removed.at(0)).toMatchObject({ module: "accounting", before: "manage", after: null });
  });

  it("refuse d'enregistrer la matrice d'un propriétaire ou la sienne", async () => {
    const adminId = await makeMember("directeur@example.com", "Directeur", "admin");
    await expect(
      saveMemberLevels(db, {
        tenantId,
        actorUserId: adminId,
        targetUserId: adminId,
        levels: allLevels({ stock: "manage" }),
      }),
    ).rejects.toThrow("Vous ne pouvez pas modifier vos propres droits.");

    await expect(
      saveMemberLevels(db, {
        tenantId,
        actorUserId: adminId,
        targetUserId: ownerId,
        levels: allLevels({ stock: "manage" }),
      }),
    ).rejects.toThrow("Le propriétaire gère tous les modules : une concession est inutile.");
  });

  it("affiche les concessions brutes à côté des niveaux effectifs", async () => {
    const userId = await makeMember("lecture@example.com", "Awa Lecture", "member");
    await saveMemberLevels(db, {
      tenantId,
      actorUserId: ownerId,
      targetUserId: userId,
      levels: allLevels({ stock: "none" }),
    });

    const team = await listTeam(db, tenantId);
    const member = team.members.find((row) => row.userId === userId);
    expect(member?.grants).toEqual({ stock: "none" });
    expect(member?.levels.sales).toBe("read");
  });
});
