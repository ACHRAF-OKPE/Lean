import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, stockLocations, stockSettings } from "@/db/schema";
import { normalizeQuantity, parseQuantity } from "./quantities";
import { StockError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StockSettingsRecord {
  readonly id: string;
  readonly defaultInternalLocationId: string | null;
  readonly defaultMinStockQty: string;
  readonly adjustmentReasonRequired: boolean;
}

export interface StockSettingsView extends StockSettingsRecord {
  readonly defaultLocationCode: string | null;
  readonly defaultLocationName: string | null;
  readonly updatedAt: Date;
}

/** STK-004 — le paramétrage est unique par espace ; son absence vaut valeurs par défaut. */
export async function loadStockSettings(
  db: Database | Transaction,
  tenantId: string,
): Promise<StockSettingsRecord | null> {
  const [row] = await db
    .select({
      id: stockSettings.id,
      defaultInternalLocationId: stockSettings.defaultInternalLocationId,
      defaultMinStockQty: stockSettings.defaultMinStockQty,
      adjustmentReasonRequired: stockSettings.adjustmentReasonRequired,
    })
    .from(stockSettings)
    .where(eq(stockSettings.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }
  return { ...row, defaultMinStockQty: normalizeQuantity(row.defaultMinStockQty) };
}

export async function getStockSettingsView(
  db: Database,
  tenantId: string,
): Promise<StockSettingsView | null> {
  const [row] = await db
    .select()
    .from(stockSettings)
    .where(eq(stockSettings.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }

  let defaultLocationCode: string | null = null;
  let defaultLocationName: string | null = null;
  if (row.defaultInternalLocationId) {
    const [location] = await db
      .select({ code: stockLocations.code, name: stockLocations.name })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.tenantId, tenantId),
          eq(stockLocations.id, row.defaultInternalLocationId),
        ),
      )
      .limit(1);
    defaultLocationCode = location?.code ?? null;
    defaultLocationName = location?.name ?? null;
  }

  return {
    id: row.id,
    defaultInternalLocationId: row.defaultInternalLocationId,
    defaultMinStockQty: normalizeQuantity(row.defaultMinStockQty),
    adjustmentReasonRequired: row.adjustmentReasonRequired,
    defaultLocationCode,
    defaultLocationName,
    updatedAt: row.updatedAt,
  };
}

export interface SaveStockSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly defaultInternalLocationId: unknown;
    readonly defaultMinStockQty: unknown;
    readonly adjustmentReasonRequired: unknown;
  };
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function checkboxOf(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on" || raw === "1";
}

/**
 * STK-004 — un magasin par défaut, un seuil de réapprovisionnement par défaut et un motif
 * d'ajustement obligatoire. Le stock négatif reste interdit : la règle STK-001 prime.
 */
export async function saveStockSettings(
  db: Database,
  input: SaveStockSettingsInput,
): Promise<{ created: boolean }> {
  const locationId = textOf(input.raw.defaultInternalLocationId);
  if (locationId && !UUID_PATTERN.test(locationId)) {
    throw new StockError("Magasin par défaut : référence invalide.");
  }

  const minStockRaw = textOf(input.raw.defaultMinStockQty) || "0";
  const parsedMinStock = parseQuantity(minStockRaw, "Seuil de réapprovisionnement par défaut", {
    allowZero: true,
  });
  if (!parsedMinStock.value) {
    throw new StockError(parsedMinStock.errors.join(" "));
  }
  const defaultMinStockQty = parsedMinStock.value;

  return db.transaction(async (tx) => {
    if (locationId) {
      const [location] = await tx
        .select({ id: stockLocations.id, code: stockLocations.code, type: stockLocations.type })
        .from(stockLocations)
        .where(and(eq(stockLocations.tenantId, input.tenantId), eq(stockLocations.id, locationId)))
        .limit(1);
      if (!location) {
        throw new StockError("Magasin par défaut : emplacement introuvable dans cet espace.");
      }
      if (location.type !== "internal") {
        throw new StockError(
          `Magasin par défaut : ${location.code} n'est pas un emplacement interne.`,
        );
      }
    }

    const [existing] = await tx
      .select({ id: stockSettings.id })
      .from(stockSettings)
      .where(eq(stockSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      defaultInternalLocationId: locationId || null,
      defaultMinStockQty,
      adjustmentReasonRequired: checkboxOf(input.raw.adjustmentReasonRequired),
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(stockSettings)
      .values(values)
      .onConflictDoUpdate({
        target: stockSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "stock.settings.update",
      entityType: "stock_settings",
      entityId: input.tenantId,
      details: {
        created: !existing,
        defaultInternalLocationId: values.defaultInternalLocationId,
        defaultMinStockQty: values.defaultMinStockQty,
        adjustmentReasonRequired: values.adjustmentReasonRequired,
      },
    });

    return { created: !existing };
  });
}
