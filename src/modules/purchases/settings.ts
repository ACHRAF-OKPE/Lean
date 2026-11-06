import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, purchaseSettings } from "@/db/schema";
import { PurchaseError } from "./errors";

export const MIN_RECEIPT_DELAY_DAYS = 0;
export const MAX_RECEIPT_DELAY_DAYS = 365;

export interface PurchaseSettingsRecord {
  readonly id: string;
  readonly defaultReceiptDelayDays: number;
}

export interface PurchaseSettingsView extends PurchaseSettingsRecord {
  readonly updatedAt: Date;
}

/** PUR-007 — le paramétrage est unique par espace ; son absence vaut valeurs par défaut. */
export async function loadPurchaseSettings(
  db: Database,
  tenantId: string,
): Promise<PurchaseSettingsRecord | null> {
  const [row] = await db
    .select({
      id: purchaseSettings.id,
      defaultReceiptDelayDays: purchaseSettings.defaultReceiptDelayDays,
    })
    .from(purchaseSettings)
    .where(eq(purchaseSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getPurchaseSettingsView(
  db: Database,
  tenantId: string,
): Promise<PurchaseSettingsView | null> {
  const [row] = await db
    .select({
      id: purchaseSettings.id,
      defaultReceiptDelayDays: purchaseSettings.defaultReceiptDelayDays,
      updatedAt: purchaseSettings.updatedAt,
    })
    .from(purchaseSettings)
    .where(eq(purchaseSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export interface SavePurchaseSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly defaultReceiptDelayDays: unknown;
  };
}

/** PUR-007 — le délai de réception par défaut est un entier de jours entre 0 et 365. */
function receiptDelayDaysOf(raw: unknown): number {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") {
    return MIN_RECEIPT_DELAY_DAYS;
  }
  if (!/^\d+$/.test(text)) {
    throw new PurchaseError("Délai de réception par défaut : nombre entier de jours attendu.");
  }
  const value = Number(text);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_RECEIPT_DELAY_DAYS ||
    value > MAX_RECEIPT_DELAY_DAYS
  ) {
    throw new PurchaseError(
      `Délai de réception par défaut : entre ${MIN_RECEIPT_DELAY_DAYS} et ${MAX_RECEIPT_DELAY_DAYS} jours.`,
    );
  }
  return value;
}

/**
 * PUR-007 — un délai de réception par défaut par espace, proposé à la saisie d'une commande.
 * L'écriture est réservée au niveau gestion du module (GEN-012) et toujours auditée.
 */
export async function savePurchaseSettings(
  db: Database,
  input: SavePurchaseSettingsInput,
): Promise<{ created: boolean }> {
  const defaultReceiptDelayDays = receiptDelayDaysOf(input.raw.defaultReceiptDelayDays);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: purchaseSettings.id })
      .from(purchaseSettings)
      .where(eq(purchaseSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      defaultReceiptDelayDays,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(purchaseSettings)
      .values(values)
      .onConflictDoUpdate({
        target: purchaseSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.settings.update",
      entityType: "purchase_settings",
      entityId: input.tenantId,
      details: { created: !existing, defaultReceiptDelayDays },
    });

    return { created: !existing };
  });
}
