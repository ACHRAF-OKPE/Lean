import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, memberships, tenants, users } from "@/db/schema";
import { hashPassword } from "./password";
import { normalizeEmail } from "./queries";

export interface BootstrapInput {
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly ownerName: string;
  readonly email: string;
  readonly password: string;
}

export interface BootstrapResult {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipCreated: boolean;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapOwner(
  db: Database,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const tenantName = input.tenantName.trim();
  const tenantSlug = input.tenantSlug.trim().toLowerCase();
  const ownerName = input.ownerName.trim();
  const email = normalizeEmail(input.email);

  if (!tenantName || !ownerName) {
    throw new Error("Le nom du tenant et celui du propriétaire sont obligatoires.");
  }
  if (!SLUG_PATTERN.test(tenantSlug)) {
    throw new Error("Le slug du tenant doit être en minuscules, chiffres et tirets.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("L'adresse e-mail du propriétaire est invalide.");
  }

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    let tenantId: string;
    const [knownTenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    if (knownTenant) {
      tenantId = knownTenant.id;
    } else {
      const [created] = await tx
        .insert(tenants)
        .values({ slug: tenantSlug, name: tenantName })
        .returning({ id: tenants.id });
      if (!created) {
        throw new Error("Tenant non créé.");
      }
      tenantId = created.id;
    }

    let userId: string;
    const [knownUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (knownUser) {
      userId = knownUser.id;
    } else {
      const [created] = await tx
        .insert(users)
        .values({ email, name: ownerName, passwordHash })
        .returning({ id: users.id });
      if (!created) {
        throw new Error("Utilisateur non créé.");
      }
      userId = created.id;
    }

    const [membership] = await tx
      .insert(memberships)
      .values({ tenantId, userId, role: "owner" })
      .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
      .returning({ id: memberships.id });

    if (membership) {
      await tx.insert(auditEvents).values({
        tenantId,
        actorUserId: userId,
        action: "identity.bootstrap",
        entityType: "membership",
        entityId: membership.id,
        details: { role: "owner" },
      });
    }

    return { tenantId, userId, membershipCreated: Boolean(membership) };
  });
}
