import type { Database } from "@/db/client";
import { memberships, tenants, users } from "@/db/schema";

let tenantCounter = 0;

export interface HrTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly otherUserId: string;
  readonly otherTenantId: string;
  readonly otherTenantUserId: string;
  readonly ownerEmail: string;
  readonly memberEmail: string;
  readonly otherTenantEmail: string;
}

/** Deux espaces, un propriétaire et un membre par espace : les tests RH mesurent l'isolation. */
export async function seedHrTenant(db: Database, label = "rh"): Promise<HrTenant> {
  tenantCounter += 1;
  const suffix = `${tenantCounter}-${label}`;

  const insertedTenants = await db
    .insert(tenants)
    .values([
      { slug: `test-rh-${suffix}`, name: `Espace RH ${label}` },
      { slug: `test-rh-autre-${suffix}`, name: `Espace voisin ${label}` },
    ])
    .returning({ id: tenants.id, slug: tenants.slug });

  const tenant = insertedTenants.find((row) => row.slug === `test-rh-${suffix}`);
  const otherTenant = insertedTenants.find((row) => row.slug === `test-rh-autre-${suffix}`);

  const insertedUsers = await db
    .insert(users)
    .values([
      { email: `rh-owner-${suffix}@test.local`, name: "Awa Owner", passwordHash: "hash-test" },
      { email: `rh-member-${suffix}@test.local`, name: "Kofi Member", passwordHash: "hash-test" },
      {
        email: `rh-other-${suffix}@test.local`,
        name: "Ibra Other",
        passwordHash: "hash-test",
      },
    ])
    .returning({ id: users.id, email: users.email });

  const owner = insertedUsers.find((row) => row.email === `rh-owner-${suffix}@test.local`);
  const member = insertedUsers.find((row) => row.email === `rh-member-${suffix}@test.local`);
  const other = insertedUsers.find((row) => row.email === `rh-other-${suffix}@test.local`);

  if (!tenant || !otherTenant || !owner || !member || !other) {
    throw new Error("Espaces RH de test non créés.");
  }

  await db.insert(memberships).values([
    { tenantId: tenant.id, userId: owner.id, role: "owner" },
    { tenantId: tenant.id, userId: member.id, role: "member" },
    { tenantId: otherTenant.id, userId: other.id, role: "owner" },
  ]);

  return {
    tenantId: tenant.id,
    userId: owner.id,
    otherUserId: member.id,
    otherTenantId: otherTenant.id,
    otherTenantUserId: other.id,
    ownerEmail: owner.email,
    memberEmail: member.email,
    otherTenantEmail: other.email,
  };
}
