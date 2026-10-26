import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, partnerContacts, partners } from "@/db/schema";
import { SettingsError } from "./errors";
import type { PartnerContactData } from "./validation";

export type PartnerContactRecord = typeof partnerContacts.$inferSelect;

async function assertPartner(db: Database, tenantId: string, partnerId: string): Promise<void> {
  const [partner] = await db
    .select({ id: partners.id })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, partnerId)))
    .limit(1);
  if (!partner) {
    throw new SettingsError("Tiers introuvable dans cet espace de travail.");
  }
}

export async function listPartnerContacts(
  db: Database,
  input: { tenantId: string; partnerId: string },
): Promise<readonly PartnerContactRecord[]> {
  return db
    .select()
    .from(partnerContacts)
    .where(
      and(
        eq(partnerContacts.tenantId, input.tenantId),
        eq(partnerContacts.partnerId, input.partnerId),
      ),
    )
    .orderBy(
      desc(partnerContacts.isPrimary),
      desc(partnerContacts.active),
      asc(partnerContacts.fullName),
    );
}

function contactDetails(contact: PartnerContactRecord): Record<string, unknown> {
  return {
    fullName: contact.fullName,
    jobTitle: contact.jobTitle,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
    active: contact.active,
  };
}

export async function createPartnerContact(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    partnerId: string;
    data: PartnerContactData;
  },
): Promise<{ id: string }> {
  await assertPartner(db, input.tenantId, input.partnerId);

  return db.transaction(async (tx) => {
    if (input.data.isPrimary) {
      await tx
        .update(partnerContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(partnerContacts.tenantId, input.tenantId),
            eq(partnerContacts.partnerId, input.partnerId),
            eq(partnerContacts.isPrimary, true),
          ),
        );
    }

    const [created] = await tx
      .insert(partnerContacts)
      .values({
        tenantId: input.tenantId,
        partnerId: input.partnerId,
        fullName: input.data.fullName,
        jobTitle: input.data.jobTitle,
        email: input.data.email,
        phone: input.data.phone,
        isPrimary: input.data.isPrimary,
        active: input.data.active,
      })
      .returning({ id: partnerContacts.id });

    if (!created) {
      throw new SettingsError("Le contact n'a pas pu être créé.");
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.contact.create",
      entityType: "partner_contact",
      entityId: created.id,
      details: { partnerId: input.partnerId, ...input.data },
    });

    return created;
  });
}

export async function updatePartnerContact(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    partnerId: string;
    contactId: string;
    data: PartnerContactData;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(partnerContacts)
      .where(
        and(
          eq(partnerContacts.tenantId, input.tenantId),
          eq(partnerContacts.partnerId, input.partnerId),
          eq(partnerContacts.id, input.contactId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new SettingsError("Contact introuvable dans cet espace de travail.");
    }

    if (input.data.isPrimary) {
      await tx
        .update(partnerContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(partnerContacts.tenantId, input.tenantId),
            eq(partnerContacts.partnerId, input.partnerId),
            eq(partnerContacts.isPrimary, true),
            ne(partnerContacts.id, input.contactId),
          ),
        );
    }

    await tx
      .update(partnerContacts)
      .set({
        fullName: input.data.fullName,
        jobTitle: input.data.jobTitle,
        email: input.data.email,
        phone: input.data.phone,
        isPrimary: input.data.isPrimary,
        active: input.data.active,
        updatedAt: new Date(),
      })
      .where(eq(partnerContacts.id, input.contactId));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.contact.update",
      entityType: "partner_contact",
      entityId: input.contactId,
      details: {
        partnerId: input.partnerId,
        before: contactDetails(existing),
        after: input.data,
      },
    });
  });
}

export async function getPartnerContact(
  db: Database,
  input: { tenantId: string; partnerId: string; contactId: string },
): Promise<PartnerContactRecord | null> {
  const [contact] = await db
    .select()
    .from(partnerContacts)
    .where(
      and(
        eq(partnerContacts.tenantId, input.tenantId),
        eq(partnerContacts.partnerId, input.partnerId),
        eq(partnerContacts.id, input.contactId),
      ),
    )
    .limit(1);
  return contact ?? null;
}
