import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, purchaseSettings } from "@/db/schema";
import { listTeam } from "@/modules/identity/team";
import { atLeast } from "@/modules/identity/modules";
import { PurchaseError } from "./errors";

export const MIN_RECEIPT_DELAY_DAYS = 0;
export const MAX_RECEIPT_DELAY_DAYS = 365;

export interface PurchaseSettingsRecord {
  readonly id: string;
  readonly defaultReceiptDelayDays: number;
  readonly validatorUserId: string | null;
  readonly signerUserIds: readonly string[];
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
      validatorUserId: purchaseSettings.validatorUserId,
      signerUserIds: purchaseSettings.signerUserIds,
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
      validatorUserId: purchaseSettings.validatorUserId,
      signerUserIds: purchaseSettings.signerUserIds,
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
    readonly validatorUserId?: unknown;
    readonly signerUserIds?: unknown;
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
  const validatorUserId = input.raw.validatorUserId
    ? String(input.raw.validatorUserId).trim()
    : null;
  const signerUserIds = Array.isArray(input.raw.signerUserIds)
    ? input.raw.signerUserIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  if (signerUserIds.length > 5 || new Set(signerUserIds).size !== signerUserIds.length) {
    throw new PurchaseError(
      "Choisissez au plus cinq signataires différents, dans l'ordre souhaité.",
    );
  }
  const team = await listTeam(db, input.tenantId);
  const eligibleSignerIds = new Set(
    team.members
      .filter((member) => atLeast(member.levels.purchases, "read"))
      .map((member) => member.userId),
  );
  if (signerUserIds.some((id) => !eligibleSignerIds.has(id))) {
    throw new PurchaseError(
      "Chaque signataire doit être membre de cet espace et avoir accès aux Achats.",
    );
  }
  if (validatorUserId && !eligibleSignerIds.has(validatorUserId)) {
    throw new PurchaseError(
      "Le validateur doit être membre de cet espace et avoir accès aux Achats.",
    );
  }

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
      validatorUserId,
      signerUserIds,
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
      details: { created: !existing, defaultReceiptDelayDays, signerCount: signerUserIds.length },
    });

    return { created: !existing };
  });
}
