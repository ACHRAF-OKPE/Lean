import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { memberships, sessions, tenants, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { bootstrapOwner } from "./bootstrap";
import { hashPassword, verifyPassword } from "./password";
import {
  endSession,
  findLoginAccount,
  findMembership,
  listAuditEvents,
  normalizeEmail,
  resolveSession,
  startSession,
  switchSessionTenant,
} from "./queries";
import { createSessionToken, SESSION_TTL_MS } from "./tokens";

let context: TestDatabase;
let db: Database;
let passwordHash: string;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  passwordHash = await hashPassword("mot-de-passe-solide");
});

afterAll(async () => {
  await context.close();
});

async function makeTenant(slug: string): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug, name: `Espace ${slug}` })
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Tenant non créé.");
  }
  return row.id;
}

async function makeUser(email: string, name = "Awa"): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("Utilisateur non créé.");
  }
  return row.id;
}

async function makeMembership(
  tenantId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  await db.insert(memberships).values({ tenantId, userId, role });
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

describe("TEN-001 — session et appartenance au tenant", () => {
  it("ne résout une session que pour le tenant de la membership", async () => {
    const tenantA = await makeTenant("alpha");
    const tenantB = await makeTenant("beta");
    const userId = await makeUser("alpha@example.com");
    await makeMembership(tenantA, userId, "owner");

    const token = createSessionToken();
    await startSession(db, {
      userId,
      tenantId: tenantA,
      tokenHash: token.tokenHash,
      expiresAt: sessionExpiry(),
    });

    const resolved = await resolveSession(db, token.tokenHash);
    expect(resolved?.tenantId).toBe(tenantA);
    expect(resolved?.tenantName).toBe("Espace alpha");
    expect(resolved?.role).toBe("owner");

    const forged = createSessionToken();
    await db.insert(sessions).values({
      userId,
      tenantId: tenantB,
      tokenHash: forged.tokenHash,
      expiresAt: sessionExpiry(),
    });
    expect(await resolveSession(db, forged.tokenHash)).toBeNull();
    expect(await findMembership(db, { userId, tenantId: tenantB })).toBeNull();
  });

  it("refuse une session expirée et une session dont la membership a disparu", async () => {
    const tenantA = await makeTenant("gamma");
    const userId = await makeUser("gamma@example.com");
    await makeMembership(tenantA, userId, "member");

    const expired = createSessionToken();
    await db.insert(sessions).values({
      userId,
      tenantId: tenantA,
      tokenHash: expired.tokenHash,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveSession(db, expired.tokenHash)).toBeNull();

    const active = createSessionToken();
    await startSession(db, {
      userId,
      tenantId: tenantA,
      tokenHash: active.tokenHash,
      expiresAt: sessionExpiry(),
    });
    expect(await resolveSession(db, active.tokenHash)).not.toBeNull();

    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantA)));
    expect(await resolveSession(db, active.tokenHash)).toBeNull();
  });

  it("normalise l'adresse de connexion", () => {
    expect(normalizeEmail("  AWA@Example.COM ")).toBe("awa@example.com");
  });
});

describe("TEN-004 / GEN-008 — audit et isolation", () => {
  it("n'expose que les évènements du tenant actif et trace les changements", async () => {
    const tenantA = await makeTenant("audit-a");
    const tenantB = await makeTenant("audit-b");
    const tenantC = await makeTenant("audit-c");
    const userId = await makeUser("audit@example.com");
    await makeMembership(tenantA, userId, "admin");
    await makeMembership(tenantB, userId, "admin");

    const token = createSessionToken();
    await startSession(db, {
      userId,
      tenantId: tenantA,
      tokenHash: token.tokenHash,
      expiresAt: sessionExpiry(),
    });

    const eventsA = await listAuditEvents(db, { tenantId: tenantA });
    expect(eventsA.some((event) => event.action === "auth.login")).toBe(true);
    expect(eventsA.every((event) => event.actorName === "Awa")).toBe(true);

    const eventsB = await listAuditEvents(db, { tenantId: tenantB });
    expect(eventsB).toHaveLength(0);

    const session = await resolveSession(db, token.tokenHash);
    if (!session) {
      throw new Error("Session attendue.");
    }
    const sessionId = session.sessionId;

    expect(await switchSessionTenant(db, { sessionId, userId, tenantId: tenantC })).toBe(false);

    expect(await switchSessionTenant(db, { sessionId, userId, tenantId: tenantB })).toBe(true);
    const moved = await resolveSession(db, token.tokenHash);
    expect(moved?.tenantId).toBe(tenantB);

    const eventsBAfterSwitch = await listAuditEvents(db, { tenantId: tenantB });
    expect(eventsBAfterSwitch[0]?.action).toBe("tenant.switch");
    expect(eventsBAfterSwitch[0]?.details).toMatchObject({
      fromTenantId: tenantA,
      toTenantId: tenantB,
    });
    expect(eventsA.every((event) => event.action !== "tenant.switch")).toBe(true);

    await endSession(db, token.tokenHash);
    expect(await resolveSession(db, token.tokenHash)).toBeNull();

    const eventsBAfterLogout = await listAuditEvents(db, { tenantId: tenantB });
    expect(eventsBAfterLogout.map((event) => event.action)).toContain("auth.logout");
  });

  it("borne la lecture du journal à la limite demandée", async () => {
    const tenantId = await makeTenant("limite");
    const userId = await makeUser("limite@example.com");
    await makeMembership(tenantId, userId, "owner");
    const token = createSessionToken();
    await startSession(db, {
      userId,
      tenantId,
      tokenHash: token.tokenHash,
      expiresAt: sessionExpiry(),
    });

    const events = await listAuditEvents(db, { tenantId, limit: 1 });
    expect(events).toHaveLength(1);
  });
});

describe("TEN-006 — changement d'espace", () => {
  it("n'accepte que le tenant d'une membership et le propriétaire de la session", async () => {
    const tenantA = await makeTenant("switch-a");
    const tenantB = await makeTenant("switch-b");
    const tenantC = await makeTenant("switch-c");
    const owner = await makeUser("switch-owner@example.com");
    const other = await makeUser("switch-other@example.com", "Koffi");
    await makeMembership(tenantA, owner, "owner");
    await makeMembership(tenantB, owner, "member");
    await makeMembership(tenantC, other, "owner");

    const token = createSessionToken();
    await startSession(db, {
      userId: owner,
      tenantId: tenantA,
      tokenHash: token.tokenHash,
      expiresAt: sessionExpiry(),
    });

    const session = await resolveSession(db, token.tokenHash);
    if (!session) {
      throw new Error("Session attendue.");
    }
    const sessionId = session.sessionId;

    expect(await switchSessionTenant(db, { sessionId, userId: owner, tenantId: tenantC })).toBe(
      false,
    );
    expect(await switchSessionTenant(db, { sessionId, userId: other, tenantId: tenantC })).toBe(
      false,
    );
    expect((await resolveSession(db, token.tokenHash))?.tenantId).toBe(tenantA);

    expect(await switchSessionTenant(db, { sessionId, userId: owner, tenantId: tenantB })).toBe(
      true,
    );
    expect((await resolveSession(db, token.tokenHash))?.tenantId).toBe(tenantB);

    const targetEvents = await listAuditEvents(db, { tenantId: tenantB });
    expect(targetEvents.filter((event) => event.action === "tenant.switch")).toHaveLength(1);
    const sourceEvents = await listAuditEvents(db, { tenantId: tenantA });
    expect(sourceEvents.every((event) => event.action !== "tenant.switch")).toBe(true);
    expect(await listAuditEvents(db, { tenantId: tenantC })).toHaveLength(0);
  });
});

describe("TEN-005 — amorçage du premier propriétaire", () => {
  it("crée tenant, propriétaire et membership une seule fois", async () => {
    const input = {
      tenantName: "Amorçage",
      tenantSlug: "amorcage",
      ownerName: "Awa",
      email: "awa.bootstrap@example.com",
      password: "mot-de-passe-solide",
    };

    const first = await bootstrapOwner(db, input);
    expect(first.membershipCreated).toBe(true);

    const second = await bootstrapOwner(db, input);
    expect(second.membershipCreated).toBe(false);
    expect(second.tenantId).toBe(first.tenantId);
    expect(second.userId).toBe(first.userId);

    const events = await listAuditEvents(db, { tenantId: first.tenantId });
    expect(events.filter((event) => event.action === "identity.bootstrap")).toHaveLength(1);

    const account = await findLoginAccount(db, "AWA.BOOTSTRAP@EXAMPLE.COM");
    expect(account?.userName).toBe("Awa");
    expect(account ? await verifyPassword(input.password, account.passwordHash) : false).toBe(true);
  });

  it("refuse un slug invalide ou un mot de passe faible", async () => {
    await expect(
      bootstrapOwner(db, {
        tenantName: "Invalide",
        tenantSlug: "Slug Invalide",
        ownerName: "Awa",
        email: "invalide@example.com",
        password: "mot-de-passe-solide",
      }),
    ).rejects.toThrow("slug");

    await expect(
      bootstrapOwner(db, {
        tenantName: "Faible",
        tenantSlug: "faible",
        ownerName: "Awa",
        email: "faible@example.com",
        password: "court",
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
