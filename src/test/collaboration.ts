import type { Database } from "@/db/client";
import { memberships, partners, tenants, users } from "@/db/schema";
import { seedSalesTenant, type SalesTenant } from "./sales";

let counter = 0;

export interface CollaborationTenant extends SalesTenant {
  readonly memberUserId: string;
  readonly memberName: string;
  readonly otherTenantId: string;
  readonly otherTenantUserId: string;
  readonly otherPartnerId: string;
}

export async function seedCollaborationTenant(
  db: Database,
  label = "collaboration",
): Promise<CollaborationTenant> {
  counter += 1;
  const base = await seedSalesTenant(db, label);

  await db.insert(memberships).values({
    tenantId: base.tenantId,
    userId: base.userId,
    role: "owner",
  });

  const [member] = await db
    .insert(users)
    .values({
      email: `collab-member-${counter}@test.local`,
      name: "Moussa Koffi",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id, name: users.name });
  if (!member) {
    throw new Error("Membre de test non créé.");
  }
  await db.insert(memberships).values({
    tenantId: base.tenantId,
    userId: member.id,
    role: "member",
  });

  const [otherTenant] = await db
    .insert(tenants)
    .values({ slug: `collab-other-${counter}`, name: "Espace voisin" })
    .returning({ id: tenants.id });
  const [otherUser] = await db
    .insert(users)
    .values({
      email: `collab-other-${counter}@test.local`,
      name: "Aya Bamba",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });
  if (!otherTenant || !otherUser) {
    throw new Error("Espace voisin de test non créé.");
  }
  await db.insert(memberships).values({
    tenantId: otherTenant.id,
    userId: otherUser.id,
    role: "owner",
  });

  const [otherPartner] = await db
    .insert(partners)
    .values({
      tenantId: otherTenant.id,
      code: "AUTR001",
      name: "Tiers voisin",
      type: "company",
      isSupplier: true,
    })
    .returning({ id: partners.id });
  if (!otherPartner) {
    throw new Error("Tiers voisin de test non créé.");
  }

  return {
    ...base,
    memberUserId: member.id,
    memberName: member.name,
    otherTenantId: otherTenant.id,
    otherTenantUserId: otherUser.id,
    otherPartnerId: otherPartner.id,
  };
}
