import type { Database } from "@/db/client";
import { articles, hsCodes, partners, tenants, users } from "@/db/schema";

let tenantCounter = 0;

export interface PurchasingTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly supplierId: string;
  readonly inactiveSupplierId: string;
  readonly customerId: string;
  readonly productId: string;
  readonly secondProductId: string;
  readonly serviceId: string;
  readonly inactiveProductId: string;
  readonly notPurchasableId: string;
}

export async function seedPurchasingTenant(
  db: Database,
  label = "achats",
): Promise<PurchasingTenant> {
  tenantCounter += 1;

  const [tenant] = await db
    .insert(tenants)
    .values({ slug: `test-${tenantCounter}-${label}`, name: `Espace ${label}` })
    .returning({ id: tenants.id });
  const [user] = await db
    .insert(users)
    .values({
      email: `achats-${tenantCounter}@test.local`,
      name: "Awa Test",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });

  if (!tenant || !user) {
    throw new Error("Tenant de test non créé.");
  }

  const [hs] = await db
    .insert(hsCodes)
    .values({ tenantId: tenant.id, code: "090111", wording: "Café non torréfié" })
    .returning({ id: hsCodes.id });

  const partnerRows = await db
    .insert(partners)
    .values([
      {
        tenantId: tenant.id,
        code: "FOUR001",
        name: "Sahel Négoce SARL",
        type: "company" as const,
        isSupplier: true,
      },
      {
        tenantId: tenant.id,
        code: "FOUR002",
        name: "Fournisseur inactif",
        type: "company" as const,
        isSupplier: true,
        active: false,
      },
      {
        tenantId: tenant.id,
        code: "CUST001",
        name: "Client seulement",
        type: "company" as const,
        isCustomer: true,
      },
    ])
    .returning({ id: partners.id, code: partners.code });
  const partnerByCode = new Map(partnerRows.map((row) => [row.code, row.id]));

  const articleRows = await db
    .insert(articles)
    .values([
      {
        tenantId: tenant.id,
        code: "ART001",
        name: "Café vert",
        type: "product" as const,
        unitCode: "KG",
        hsCodeId: hs?.id ?? null,
        purchasePriceXof: 1000,
      },
      {
        tenantId: tenant.id,
        code: "ART002",
        name: "Sucre roux",
        type: "product" as const,
        unitCode: "KG",
        hsCodeId: hs?.id ?? null,
        purchasePriceXof: 450,
      },
      {
        tenantId: tenant.id,
        code: "SRV001",
        name: "Transport maritime",
        type: "service" as const,
        unitCode: "H",
        purchasePriceXof: 50000,
      },
      {
        tenantId: tenant.id,
        code: "ART003",
        name: "Article inactif",
        type: "product" as const,
        unitCode: "PCE",
        hsCodeId: hs?.id ?? null,
        active: false,
      },
      {
        tenantId: tenant.id,
        code: "ART004",
        name: "Article non achetable",
        type: "product" as const,
        unitCode: "PCE",
        hsCodeId: hs?.id ?? null,
        isPurchasable: false,
      },
    ])
    .returning({ id: articles.id, code: articles.code });
  const articleByCode = new Map(articleRows.map((row) => [row.code, row.id]));

  const supplierId = partnerByCode.get("FOUR001");
  const inactiveSupplierId = partnerByCode.get("FOUR002");
  const customerId = partnerByCode.get("CUST001");
  const productId = articleByCode.get("ART001");
  const secondProductId = articleByCode.get("ART002");
  const serviceId = articleByCode.get("SRV001");
  const inactiveProductId = articleByCode.get("ART003");
  const notPurchasableId = articleByCode.get("ART004");

  if (
    !supplierId ||
    !inactiveSupplierId ||
    !customerId ||
    !productId ||
    !secondProductId ||
    !serviceId ||
    !inactiveProductId ||
    !notPurchasableId
  ) {
    throw new Error("Référentiel de test incomplet.");
  }

  return {
    tenantId: tenant.id,
    userId: user.id,
    supplierId,
    inactiveSupplierId,
    customerId,
    productId,
    secondProductId,
    serviceId,
    inactiveProductId,
    notPurchasableId,
  };
}
