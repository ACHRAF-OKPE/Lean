import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, companySettings } from "@/db/schema";
import type { CompanyProfileData, LogoMime } from "./validation";

export interface CompanySettingsSummary {
  readonly id: string;
  readonly legalName: string;
  readonly legalForm: string | null;
  readonly capitalXof: number | null;
  readonly taxId: string | null;
  readonly rccm: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly logoMime: string | null;
  readonly invoiceFooter: string | null;
  readonly paymentTermDays: number;
  readonly defaultIncoterm: string | null;
  readonly bankName: string | null;
  readonly bankAccountHolder: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankSwift: string | null;
  readonly updatedAt: Date;
}

const PROFILE_COLUMNS = {
  legalName: companySettings.legalName,
  legalForm: companySettings.legalForm,
  capitalXof: companySettings.capitalXof,
  taxId: companySettings.taxId,
  rccm: companySettings.rccm,
  addressLine: companySettings.addressLine,
  city: companySettings.city,
  postalCode: companySettings.postalCode,
  countryCode: companySettings.countryCode,
  email: companySettings.email,
  phone: companySettings.phone,
  website: companySettings.website,
  invoiceFooter: companySettings.invoiceFooter,
  paymentTermDays: companySettings.paymentTermDays,
  defaultIncoterm: companySettings.defaultIncoterm,
  bankName: companySettings.bankName,
  bankAccountHolder: companySettings.bankAccountHolder,
  bankAccountNumber: companySettings.bankAccountNumber,
  bankSwift: companySettings.bankSwift,
};

function profileValues(data: CompanyProfileData) {
  return {
    legalName: data.legalName,
    legalForm: data.legalForm,
    capitalXof: data.capitalXof,
    taxId: data.taxId,
    rccm: data.rccm,
    addressLine: data.addressLine,
    city: data.city,
    postalCode: data.postalCode,
    countryCode: data.countryCode,
    email: data.email,
    phone: data.phone,
    website: data.website,
    invoiceFooter: data.invoiceFooter,
    paymentTermDays: data.paymentTermDays,
    defaultIncoterm: data.defaultIncoterm,
    bankName: data.bankName,
    bankAccountHolder: data.bankAccountHolder,
    bankAccountNumber: data.bankAccountNumber,
    bankSwift: data.bankSwift,
  };
}

function differingFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): readonly string[] {
  if (!before) {
    return Object.keys(after);
  }
  return Object.keys(after).filter((key) => {
    const previous = before[key] ?? null;
    const next = after[key] ?? null;
    return previous !== next;
  });
}

export async function getCompanySettings(
  db: Database,
  tenantId: string,
): Promise<CompanySettingsSummary | null> {
  const [row] = await db
    .select({
      id: companySettings.id,
      ...PROFILE_COLUMNS,
      logoMime: companySettings.logoMime,
      updatedAt: companySettings.updatedAt,
    })
    .from(companySettings)
    .where(eq(companySettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getCompanyLogo(
  db: Database,
  tenantId: string,
): Promise<{ mime: LogoMime; data: Uint8Array } | null> {
  const [row] = await db
    .select({ mime: companySettings.logoMime, data: companySettings.logoData })
    .from(companySettings)
    .where(eq(companySettings.tenantId, tenantId))
    .limit(1);
  if (!row?.mime || !row.data) {
    return null;
  }
  return { mime: row.mime as LogoMime, data: row.data };
}

export async function updateCompanySettings(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: CompanyProfileData },
): Promise<{ created: boolean; changed: readonly string[] }> {
  const values = profileValues(input.data);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select(PROFILE_COLUMNS)
      .from(companySettings)
      .where(eq(companySettings.tenantId, input.tenantId))
      .limit(1);

    const after = values as unknown as Record<string, unknown>;
    const before = existing ? (existing as unknown as Record<string, unknown>) : null;
    const changed = differingFields(before, after);

    await tx
      .insert(companySettings)
      .values({ tenantId: input.tenantId, ...values })
      .onConflictDoUpdate({
        target: companySettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "settings.company.update",
      entityType: "company_settings",
      entityId: input.tenantId,
      details: {
        created: !existing,
        changed,
        before: before
          ? Object.fromEntries(changed.map((key) => [key, before[key] ?? null]))
          : null,
        after: Object.fromEntries(changed.map((key) => [key, after[key] ?? null])),
      },
    });

    return { created: !existing, changed };
  });
}

export async function setCompanyLogo(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    legalName: string;
    mime: LogoMime;
    data: Uint8Array;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ mime: companySettings.logoMime })
      .from(companySettings)
      .where(eq(companySettings.tenantId, input.tenantId))
      .limit(1);

    if (!existing) {
      await tx.insert(companySettings).values({
        tenantId: input.tenantId,
        legalName: input.legalName || "Entreprise",
        logoMime: input.mime,
        logoData: input.data,
      });
    } else {
      await tx
        .update(companySettings)
        .set({ logoMime: input.mime, logoData: input.data, updatedAt: new Date() })
        .where(eq(companySettings.tenantId, input.tenantId));
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "settings.logo.update",
      entityType: "company_settings",
      entityId: input.tenantId,
      details: {
        mime: input.mime,
        size: input.data.length,
        previousMime: existing?.mime ?? null,
      },
    });
  });
}

export async function clearCompanyLogo(
  db: Database,
  input: { tenantId: string; actorUserId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ mime: companySettings.logoMime })
      .from(companySettings)
      .where(eq(companySettings.tenantId, input.tenantId))
      .limit(1);

    if (!existing?.mime) {
      return false;
    }

    await tx
      .update(companySettings)
      .set({ logoMime: null, logoData: null, updatedAt: new Date() })
      .where(eq(companySettings.tenantId, input.tenantId));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "settings.logo.delete",
      entityType: "company_settings",
      entityId: input.tenantId,
      details: { previousMime: existing.mime },
    });

    return true;
  });
}
