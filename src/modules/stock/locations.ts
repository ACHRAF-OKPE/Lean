import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { stockLocations } from "@/db/schema";
import { StockError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const DEFAULT_INTERNAL_CODE = "MAG";
export const DEFAULT_SUPPLIER_CODE = "FOURN";
export const DEFAULT_CUSTOMER_CODE = "CLIENT";

export interface DefaultLocations {
  readonly internalId: string;
  readonly supplierId: string;
  readonly customerId: string;
}

export interface LocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export async function ensureDefaultLocations(
  tx: Transaction,
  tenantId: string,
): Promise<DefaultLocations> {
  await tx
    .insert(stockLocations)
    .values([
      { tenantId, code: DEFAULT_INTERNAL_CODE, name: "Magasin principal", type: "internal" },
      {
        tenantId,
        code: DEFAULT_SUPPLIER_CODE,
        name: "Fournisseur (virtuel)",
        type: "supplier",
      },
      {
        tenantId,
        code: DEFAULT_CUSTOMER_CODE,
        name: "Client (virtuel)",
        type: "customer",
      },
    ])
    .onConflictDoNothing({ target: [stockLocations.tenantId, stockLocations.code] });

  const rows = await tx
    .select({
      id: stockLocations.id,
      code: stockLocations.code,
      type: stockLocations.type,
    })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        inArray(stockLocations.code, [
          DEFAULT_INTERNAL_CODE,
          DEFAULT_SUPPLIER_CODE,
          DEFAULT_CUSTOMER_CODE,
        ]),
      ),
    );

  const internal = rows.find((row) => row.code === DEFAULT_INTERNAL_CODE);
  const supplier = rows.find((row) => row.code === DEFAULT_SUPPLIER_CODE);
  const customer = rows.find((row) => row.code === DEFAULT_CUSTOMER_CODE);
  if (
    !internal ||
    !supplier ||
    !customer ||
    internal.type !== "internal" ||
    supplier.type !== "supplier" ||
    customer.type !== "customer"
  ) {
    throw new StockError("Les emplacements par défaut MAG, FOURN et CLIENT sont introuvables.");
  }

  return { internalId: internal.id, supplierId: supplier.id, customerId: customer.id };
}

export async function listInternalLocations(
  db: Database,
  tenantId: string,
): Promise<readonly LocationOption[]> {
  await db.transaction(async (tx) => {
    await ensureDefaultLocations(tx, tenantId);
  });

  return db
    .select({ id: stockLocations.id, code: stockLocations.code, name: stockLocations.name })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, tenantId),
        eq(stockLocations.type, "internal"),
        eq(stockLocations.active, true),
      ),
    )
    .orderBy(asc(stockLocations.code));
}
