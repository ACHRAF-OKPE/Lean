import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, invoiceSettings } from "@/db/schema";
import { isoDatePlusDays } from "@/lib/dates";
import { SalesError } from "./errors";

export const DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS = 30;
export const MIN_INVOICE_DUE_DATE_OFFSET_DAYS = 0;
export const MAX_INVOICE_DUE_DATE_OFFSET_DAYS = 365;

export interface InvoiceSettingsRecord {
  readonly id: string;
  readonly dueDateOffsetDays: number;
}

export interface InvoiceSettingsView extends InvoiceSettingsRecord {
  readonly updatedAt: Date;
}

/** SAL-010 — la date proposée part de la date de facture et conserve le délai actuel si absent. */
export function defaultInvoiceDueDate(
  invoiceDate: string,
  settings: InvoiceSettingsRecord | null,
): string {
  return isoDatePlusDays(
    invoiceDate,
    settings?.dueDateOffsetDays ?? DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS,
  );
}

/** SAL-010 — le délai d'échéance est propre à l'espace ; l'absence garde le délai actuel de 30 jours. */
export async function loadInvoiceSettings(
  db: Database,
  tenantId: string,
): Promise<InvoiceSettingsRecord | null> {
  const [row] = await db
    .select({ id: invoiceSettings.id, dueDateOffsetDays: invoiceSettings.dueDateOffsetDays })
    .from(invoiceSettings)
    .where(eq(invoiceSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getInvoiceSettingsView(
  db: Database,
  tenantId: string,
): Promise<InvoiceSettingsView | null> {
  const [row] = await db
    .select({
      id: invoiceSettings.id,
      dueDateOffsetDays: invoiceSettings.dueDateOffsetDays,
      updatedAt: invoiceSettings.updatedAt,
    })
    .from(invoiceSettings)
    .where(eq(invoiceSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export interface SaveInvoiceSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: { readonly dueDateOffsetDays: unknown };
}

/** SAL-010 — le délai saisi est un nombre entier de jours entre 0 et 365. */
function dueDateOffsetDaysOf(raw: unknown): number {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") {
    return DEFAULT_INVOICE_DUE_DATE_OFFSET_DAYS;
  }
  if (!/^\d+$/.test(text)) {
    throw new SalesError("Délai d'échéance par défaut : nombre entier de jours attendu.");
  }
  const value = Number(text);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_INVOICE_DUE_DATE_OFFSET_DAYS ||
    value > MAX_INVOICE_DUE_DATE_OFFSET_DAYS
  ) {
    throw new SalesError(
      `Délai d'échéance par défaut : entre ${MIN_INVOICE_DUE_DATE_OFFSET_DAYS} et ${MAX_INVOICE_DUE_DATE_OFFSET_DAYS} jours.`,
    );
  }
  return value;
}

/**
 * SAL-010 — le paramétrage est unique par espace, réservé au niveau gestion et toujours audité.
 */
export async function saveInvoiceSettings(
  db: Database,
  input: SaveInvoiceSettingsInput,
): Promise<{ created: boolean }> {
  const dueDateOffsetDays = dueDateOffsetDaysOf(input.raw.dueDateOffsetDays);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: invoiceSettings.id })
      .from(invoiceSettings)
      .where(eq(invoiceSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      dueDateOffsetDays,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(invoiceSettings)
      .values(values)
      .onConflictDoUpdate({
        target: invoiceSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "invoice.settings.update",
      entityType: "invoice_settings",
      entityId: input.tenantId,
      details: { created: !existing, dueDateOffsetDays },
    });

    return { created: !existing };
  });
}
