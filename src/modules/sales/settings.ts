import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, salesSettings } from "@/db/schema";
import { SalesError } from "./errors";

export const MIN_DELIVERY_DELAY_DAYS = 0;
export const MAX_DELIVERY_DELAY_DAYS = 365;

export interface SalesSettingsRecord {
  readonly id: string;
  readonly defaultDeliveryDelayDays: number;
}

export interface SalesSettingsView extends SalesSettingsRecord {
  readonly updatedAt: Date;
}

/** SAL-009 — le paramétrage est unique par espace ; son absence vaut valeurs par défaut. */
export async function loadSalesSettings(
  db: Database,
  tenantId: string,
): Promise<SalesSettingsRecord | null> {
  const [row] = await db
    .select({
      id: salesSettings.id,
      defaultDeliveryDelayDays: salesSettings.defaultDeliveryDelayDays,
    })
    .from(salesSettings)
    .where(eq(salesSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getSalesSettingsView(
  db: Database,
  tenantId: string,
): Promise<SalesSettingsView | null> {
  const [row] = await db
    .select({
      id: salesSettings.id,
      defaultDeliveryDelayDays: salesSettings.defaultDeliveryDelayDays,
      updatedAt: salesSettings.updatedAt,
    })
    .from(salesSettings)
    .where(eq(salesSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export interface SaveSalesSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly defaultDeliveryDelayDays: unknown;
  };
}

/** SAL-009 — le délai de livraison par défaut est un entier de jours entre 0 et 365. */
function deliveryDelayDaysOf(raw: unknown): number {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") {
    return MIN_DELIVERY_DELAY_DAYS;
  }
  if (!/^\d+$/.test(text)) {
    throw new SalesError("Délai de livraison par défaut : nombre entier de jours attendu.");
  }
  const value = Number(text);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_DELIVERY_DELAY_DAYS ||
    value > MAX_DELIVERY_DELAY_DAYS
  ) {
    throw new SalesError(
      `Délai de livraison par défaut : entre ${MIN_DELIVERY_DELAY_DAYS} et ${MAX_DELIVERY_DELAY_DAYS} jours.`,
    );
  }
  return value;
}

/**
 * SAL-009 — un délai de livraison par défaut par espace, proposé à la saisie d'une commande
 * client. L'écriture est réservée au niveau gestion du module (GEN-012) et toujours auditée.
 */
export async function saveSalesSettings(
  db: Database,
  input: SaveSalesSettingsInput,
): Promise<{ created: boolean }> {
  const defaultDeliveryDelayDays = deliveryDelayDaysOf(input.raw.defaultDeliveryDelayDays);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: salesSettings.id })
      .from(salesSettings)
      .where(eq(salesSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      defaultDeliveryDelayDays,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(salesSettings)
      .values(values)
      .onConflictDoUpdate({
        target: salesSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "sales.settings.update",
      entityType: "sales_settings",
      entityId: input.tenantId,
      details: { created: !existing, defaultDeliveryDelayDays },
    });

    return { created: !existing };
  });
}
