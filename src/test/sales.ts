import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { articles, hsCodes, partners } from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";
import { ensureDefaultLocations } from "@/modules/stock/locations";
import { insertStockMove } from "@/modules/stock/moves";
import { seedPurchasingTenant, type PurchasingTenant } from "./purchases";

export interface SalesTenant extends PurchasingTenant {
  readonly inactiveCustomerId: string;
  readonly notSellableId: string;
  readonly locationId: string;
  readonly customerLocationId: string;
}

export async function seedSalesTenant(db: Database, label = "ventes"): Promise<SalesTenant> {
  const base = await seedPurchasingTenant(db, label);

  await db
    .update(articles)
    .set({ salePriceXof: 1500 })
    .where(and(eq(articles.tenantId, base.tenantId), eq(articles.code, "ART001")));
  await db
    .update(articles)
    .set({ salePriceXof: 700 })
    .where(and(eq(articles.tenantId, base.tenantId), eq(articles.code, "ART002")));
  await db
    .update(articles)
    .set({ salePriceXof: 75000 })
    .where(and(eq(articles.tenantId, base.tenantId), eq(articles.code, "SRV001")));

  const [inactiveCustomer] = await db
    .insert(partners)
    .values({
      tenantId: base.tenantId,
      code: "CLI-INACTIF",
      name: "Client inactif",
      type: "company",
      isCustomer: true,
      active: false,
    })
    .returning({ id: partners.id });

  const [hs] = await db
    .select({ id: hsCodes.id })
    .from(hsCodes)
    .where(eq(hsCodes.tenantId, base.tenantId))
    .limit(1);

  const [notSellable] = await db
    .insert(articles)
    .values({
      tenantId: base.tenantId,
      code: "ART005",
      name: "Article non vendable",
      type: "product",
      unitCode: "PCE",
      hsCodeId: hs?.id ?? null,
      isSellable: false,
    })
    .returning({ id: articles.id });

  if (!inactiveCustomer || !notSellable) {
    throw new Error("Référentiel de vente incomplet.");
  }

  const defaults = await db.transaction(async (tx) => {
    const locations = await ensureDefaultLocations(tx, base.tenantId);
    await insertStockMove(tx, {
      tenantId: base.tenantId,
      actorUserId: base.userId,
      type: "incoming",
      fromLocationId: locations.supplierId,
      toLocationId: locations.internalId,
      partnerId: base.supplierId,
      realDate: todayIsoDate(),
      notes: "Stock initial de test",
      lines: [
        { articleId: base.productId, qty: "100", unitPriceXof: 1000 },
        { articleId: base.secondProductId, qty: "40", unitPriceXof: 450 },
      ],
    });
    return locations;
  });

  return {
    ...base,
    inactiveCustomerId: inactiveCustomer.id,
    notSellableId: notSellable.id,
    locationId: defaults.internalId,
    customerLocationId: defaults.customerId,
  };
}
