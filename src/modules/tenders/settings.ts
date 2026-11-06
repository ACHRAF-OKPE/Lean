import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, tenderSettings } from "@/db/schema";
import { isoDatePlusDays } from "@/lib/dates";
import { TenderError } from "./errors";

export const DEFAULT_TENDER_DEADLINE_DAYS = 7;
export const SUPPLY_TENDER_FALLBACK_DAYS = 7;
export const MIN_TENDER_DEADLINE_DAYS = 1;
export const MAX_TENDER_DEADLINE_DAYS = 365;

export interface TenderSettingsRecord {
  readonly id: string;
  readonly defaultDeadlineDays: number;
}

export interface TenderSettingsView extends TenderSettingsRecord {
  readonly updatedAt: Date;
}

/** SCM-013 — seul un paramétrage enregistré propose une échéance à la création. */
export function defaultTenderDeadlineDate(
  today: string,
  settings: Pick<TenderSettingsRecord, "defaultDeadlineDays"> | null,
): string | null {
  return settings ? isoDatePlusDays(today, settings.defaultDeadlineDays) : null;
}

/** SCM-011 — la conversion des besoins conserve son délai historique de sept jours sans réglage. */
export function supplyTenderDeadlineDate(
  today: string,
  settings: Pick<TenderSettingsRecord, "defaultDeadlineDays"> | null,
): string {
  return (
    defaultTenderDeadlineDate(today, settings) ??
    isoDatePlusDays(today, SUPPLY_TENDER_FALLBACK_DAYS)
  );
}

export async function loadTenderSettings(
  db: Database,
  tenantId: string,
): Promise<TenderSettingsRecord | null> {
  const [row] = await db
    .select({ id: tenderSettings.id, defaultDeadlineDays: tenderSettings.defaultDeadlineDays })
    .from(tenderSettings)
    .where(eq(tenderSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getTenderSettingsView(
  db: Database,
  tenantId: string,
): Promise<TenderSettingsView | null> {
  const [row] = await db
    .select({
      id: tenderSettings.id,
      defaultDeadlineDays: tenderSettings.defaultDeadlineDays,
      updatedAt: tenderSettings.updatedAt,
    })
    .from(tenderSettings)
    .where(eq(tenderSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export interface SaveTenderSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: { readonly defaultDeadlineDays: unknown };
}

function deadlineDaysOf(raw: unknown): number {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  const value = text === "" ? DEFAULT_TENDER_DEADLINE_DAYS : Number(text);
  if (!/^\d+$/.test(text) && text !== "") {
    throw new TenderError("Délai de réponse par défaut : nombre entier de jours attendu.");
  }
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TENDER_DEADLINE_DAYS ||
    value > MAX_TENDER_DEADLINE_DAYS
  ) {
    throw new TenderError(
      `Délai de réponse par défaut : entre ${MIN_TENDER_DEADLINE_DAYS} et ${MAX_TENDER_DEADLINE_DAYS} jours.`,
    );
  }
  return value;
}

/** SCM-013 — un délai unique par espace, enregistré au niveau gestion et audité. */
export async function saveTenderSettings(
  db: Database,
  input: SaveTenderSettingsInput,
): Promise<{ created: boolean }> {
  const defaultDeadlineDays = deadlineDaysOf(input.raw.defaultDeadlineDays);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: tenderSettings.id })
      .from(tenderSettings)
      .where(eq(tenderSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      defaultDeadlineDays,
      updatedByUserId: input.actorUserId,
    };
    await tx
      .insert(tenderSettings)
      .values(values)
      .onConflictDoUpdate({
        target: tenderSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.settings.update",
      entityType: "tender_settings",
      entityId: input.tenantId,
      details: { created: !existing, defaultDeadlineDays },
    });

    return { created: !existing };
  });
}
