"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import type { SettingsFormState } from "@/lib/settings/form-state";
import { createPartnerContact, updatePartnerContact } from "@/modules/settings/contacts";
import { SettingsError } from "@/modules/settings/errors";
import {
  clearCompanyLogo,
  setCompanyLogo,
  updateCompanySettings,
} from "@/modules/settings/queries";
import {
  MAX_LOGO_BYTES,
  validateCompanyProfile,
  validateLogo,
  validatePartnerContact,
} from "@/modules/settings/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown): SettingsFormState {
  if (error instanceof SettingsError) {
    return { errors: [error.message] };
  }
  throw error;
}

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function updateCompanyAction(
  _state: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requirePermission("settings.manage");
  const validation = validateCompanyProfile({
    legalName: formText(formData, "legalName"),
    legalForm: formText(formData, "legalForm"),
    capitalXof: formText(formData, "capitalXof"),
    taxId: formText(formData, "taxId"),
    rccm: formText(formData, "rccm"),
    addressLine: formText(formData, "addressLine"),
    city: formText(formData, "city"),
    postalCode: formText(formData, "postalCode"),
    countryCode: formText(formData, "countryCode"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    website: formText(formData, "website"),
    invoiceFooter: formText(formData, "invoiceFooter"),
    paymentTermDays: formText(formData, "paymentTermDays"),
    defaultIncoterm: formText(formData, "defaultIncoterm"),
    bankName: formText(formData, "bankName"),
    bankAccountHolder: formText(formData, "bankAccountHolder"),
    bankAccountNumber: formText(formData, "bankAccountNumber"),
    bankSwift: formText(formData, "bankSwift"),
  });

  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  let created = false;
  try {
    const result = await updateCompanySettings(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: validation.data,
    });
    created = result.created;
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/parametres");
  redirect(`/parametres?enregistre=${created ? "cree" : "maj"}`);
}

export async function uploadCompanyLogoAction(
  _state: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requirePermission("settings.manage");
  const file = formData.get("logo");

  if (!(file instanceof File) || file.size === 0) {
    return { errors: ["Logo : sélectionnez un fichier PNG, JPEG ou WebP."] };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { errors: ["Logo : 512 Kio maximum."] };
  }

  const validation = validateLogo({
    bytes: new Uint8Array(await file.arrayBuffer()),
    declaredMime: file.type,
  });
  if (validation.errors.length > 0 || !validation.data.mime) {
    return { errors: validation.errors };
  }

  try {
    await setCompanyLogo(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      legalName: session.tenantName,
      mime: validation.data.mime,
      data: validation.data.bytes,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/parametres");
  redirect("/parametres?logo=maj");
}

export async function removeCompanyLogoAction(
  _state: SettingsFormState,
  _formData: FormData,
): Promise<SettingsFormState> {
  void _state;
  void _formData;
  const session = await requirePermission("settings.manage");
  await clearCompanyLogo(getDb(), {
    tenantId: session.tenantId,
    actorUserId: session.userId,
  });
  revalidatePath("/parametres");
  redirect("/parametres?logo=supprime");
}

function contactRaw(formData: FormData): Record<string, unknown> {
  return {
    fullName: formText(formData, "fullName"),
    jobTitle: formText(formData, "jobTitle"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    isPrimary: formData.get("isPrimary") === "on",
    active: formData.get("active") === "on",
  };
}

export async function createContactAction(
  _state: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requirePermission("data.write");
  const partnerId = String(formData.get("partnerId") ?? "");
  if (!UUID_PATTERN.test(partnerId)) {
    return { errors: ["Tiers invalide."] };
  }

  const validation = validatePartnerContact(contactRaw(formData));
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    await createPartnerContact(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId,
      data: validation.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/tiers/${partnerId}`);
  redirect(`/tiers/${partnerId}?contact=cree`);
}

export async function updateContactAction(
  _state: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requirePermission("data.write");
  const partnerId = String(formData.get("partnerId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!UUID_PATTERN.test(partnerId) || !UUID_PATTERN.test(contactId)) {
    return { errors: ["Contact invalide."] };
  }

  const validation = validatePartnerContact(contactRaw(formData));
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    await updatePartnerContact(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      partnerId,
      contactId,
      data: validation.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/tiers/${partnerId}`);
  redirect(`/tiers/${partnerId}?contact=maj`);
}
