import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { companySettings, partnerContacts, partners } from "@/db/schema";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { seedPurchasingTenant, type PurchasingTenant } from "./purchases";

export interface ExchangeTenant extends PurchasingTenant {
  readonly contactId: string;
  readonly contactEmail: string;
  readonly requestedOrderId: string;
  readonly confirmedOrderId: string;
}

export async function seedExchangeTenant(
  db: Database,
  label = "echanges",
): Promise<ExchangeTenant> {
  const ids = await seedPurchasingTenant(db, label);

  await db.insert(companySettings).values({
    tenantId: ids.tenantId,
    legalName: "Lean SARL",
    legalForm: "SARL",
    addressLine: "Boulevard Valéry Giscard d'Estaing",
    city: "Abidjan",
    postalCode: "00225",
    countryCode: "CI",
    email: "contact@lean.test",
    phone: "+225 27 20 00 00 00",
    taxId: "CI-1234567 A",
    rccm: "CI-ABJ-2026-B-00001",
    invoiceFooter: "Règlement par virement uniquement.",
    paymentTermDays: 30,
    defaultIncoterm: "FOB",
    bankName: "Banque Atlantique",
    bankAccountHolder: "Lean SARL",
    bankAccountNumber: "CI001234567890123456789",
    bankSwift: "ATCIABID",
  });

  const [contact] = await db
    .insert(partnerContacts)
    .values({
      tenantId: ids.tenantId,
      partnerId: ids.supplierId,
      fullName: "Mariam Traoré",
      jobTitle: "Responsable achats",
      email: "mariam@sahel.test",
      isPrimary: true,
      active: true,
    })
    .returning({ id: partnerContacts.id });

  await db
    .update(partners)
    .set({
      email: "contact@sahel.test",
      addressLine: "Zone industrielle de Yopougon",
      city: "Abidjan",
      countryCode: "CI",
    })
    .where(eq(partners.id, ids.supplierId));

  if (!contact) {
    throw new Error("Contact fournisseur de test non créé.");
  }

  const lines = [
    { articleId: ids.productId, qty: "2", unitPriceXof: 1000 },
    { articleId: ids.serviceId, qty: "1", unitPriceXof: 50000 },
  ];

  const requested = await createPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      supplierId: ids.supplierId,
      expectedReceiptDate: "2026-11-05",
      externalReference: "REF-FOUR-001",
      notes: "Livraison avant midi.",
      lines,
    },
  });
  await transitionPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: requested.id,
    action: "request",
  });

  const confirmed = await createPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      supplierId: ids.supplierId,
      expectedReceiptDate: "2026-11-05",
      externalReference: "REF-FOUR-002",
      notes: "",
      lines,
    },
  });
  await transitionPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: confirmed.id,
    action: "request",
  });
  await transitionPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: confirmed.id,
    action: "confirm",
  });

  return {
    ...ids,
    contactId: contact.id,
    contactEmail: "mariam@sahel.test",
    requestedOrderId: requested.id,
    confirmedOrderId: confirmed.id,
  };
}
