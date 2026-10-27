"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { resolveAppUrl } from "@/lib/app-url";
import { requirePermission } from "@/lib/auth/session";
import type { ExchangeFormState } from "@/lib/exchange/form-state";
import { ExchangeError } from "@/modules/exchange/errors";
import {
  createExchangeTemplate,
  getEmailAccount,
  listExchangeRecipients,
  resendExchangeMessage,
  saveEmailAccount,
  sendPurchaseExchange,
  testEmailAccountConnection,
  updateExchangeTemplate,
} from "@/modules/exchange/queries";
import {
  isExchangeType,
  validateEmailAccount,
  validateExchangeSend,
  validateExchangeTemplate,
} from "@/modules/exchange/validation";
import { getPurchaseOrder } from "@/modules/purchases/queries";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function failure(error: unknown): ExchangeFormState {
  if (error instanceof ExchangeError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function saveEmailAccountAction(
  _state: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const session = await requirePermission("settings.manage");
  const db = getDb();
  const existing = await getEmailAccount(db, session.tenantId);

  const validation = validateEmailAccount(
    {
      name: text(formData, "name"),
      host: text(formData, "host"),
      port: text(formData, "port"),
      security: text(formData, "security"),
      username: text(formData, "username"),
      password: text(formData, "password"),
      removePassword: formData.get("removePassword") === "on",
      fromName: text(formData, "fromName"),
      fromAddress: text(formData, "fromAddress"),
      replyTo: text(formData, "replyTo"),
      active: formData.get("active") === "on",
    },
    { hasStoredPassword: Boolean(existing?.hasPassword) },
  );
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    await saveEmailAccount(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: validation.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/parametres/echanges");
  redirect("/parametres/echanges?compte=enregistre");
}

export async function testEmailAccountAction(
  _state: ExchangeFormState,
  _formData: FormData,
): Promise<ExchangeFormState> {
  void _state;
  void _formData;
  const session = await requirePermission("settings.manage");
  let result: { host: string; port: number };
  try {
    result = await testEmailAccountConnection(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
    });
  } catch (error) {
    if (error instanceof ExchangeError) {
      redirect(
        `/parametres/echanges?test=echec&raison=${encodeURIComponent(error.message.slice(0, 600))}`,
      );
    }
    throw error;
  }

  redirect(`/parametres/echanges?test=ok&hote=${encodeURIComponent(result.host)}`);
}

function templateRaw(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, "name"),
    type: text(formData, "type"),
    subject: text(formData, "subject"),
    body: text(formData, "body"),
    isDefault: formData.get("isDefault") === "on",
    active: formData.get("active") === "on",
  };
}

export async function createExchangeTemplateAction(
  _state: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const session = await requirePermission("settings.manage");
  const validation = validateExchangeTemplate(templateRaw(formData));
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    await createExchangeTemplate(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: validation.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/parametres/echanges");
  redirect("/parametres/echanges?modele=cree");
}

export async function updateExchangeTemplateAction(
  _state: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const session = await requirePermission("settings.manage");
  const templateId = text(formData, "templateId") ?? "";
  if (!UUID_PATTERN.test(templateId)) {
    return { errors: ["Modèle invalide."] };
  }

  const validation = validateExchangeTemplate(templateRaw(formData));
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    await updateExchangeTemplate(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      templateId,
      data: validation.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/parametres/echanges");
  revalidatePath(`/parametres/echanges/modeles/${templateId}`);
  redirect("/parametres/echanges?modele=maj");
}

export async function sendPurchaseExchangeAction(
  _state: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const session = await requirePermission("data.write");
  const orderId = text(formData, "orderId") ?? "";
  const type = text(formData, "type") ?? "";
  const templateId = text(formData, "templateId") ?? "";

  if (!UUID_PATTERN.test(orderId)) {
    return { errors: ["Commande invalide."] };
  }
  if (!isExchangeType(type)) {
    return { errors: ["Type d'échange inconnu."] };
  }
  if (templateId && !UUID_PATTERN.test(templateId)) {
    return { errors: ["Modèle invalide."] };
  }

  const validation = validateExchangeSend({
    recipient: text(formData, "recipient"),
    subject: text(formData, "subject"),
    body: text(formData, "body"),
  });
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  const db = getDb();
  const detail = await getPurchaseOrder(db, { tenantId: session.tenantId, orderId });
  if (!detail) {
    return { errors: ["Commande introuvable dans cet espace de travail."] };
  }
  const recipients = await listExchangeRecipients(db, session.tenantId, detail.order.supplierId);
  const recipientName =
    recipients.find((recipient) => recipient.email === validation.data.recipient)?.name ?? null;

  let messageId: string;
  try {
    const result = await sendPurchaseExchange(db, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      senderName: session.userName,
      orderId,
      type,
      templateId: templateId || null,
      recipient: validation.data.recipient,
      recipientName,
      subject: validation.data.subject,
      body: validation.data.body,
      appUrl: await resolveAppUrl(),
    });
    messageId = result.messageId;
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/achats/${orderId}`);
  revalidatePath("/echanges");
  redirect(`/echanges/${messageId}?envoye=1`);
}

export async function resendExchangeMessageAction(
  _state: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  const session = await requirePermission("data.write");
  const messageId = text(formData, "messageId") ?? "";
  if (!UUID_PATTERN.test(messageId)) {
    return { errors: ["Message invalide."] };
  }

  let createdId: string;
  try {
    const result = await resendExchangeMessage(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      senderName: session.userName,
      messageId,
      appUrl: await resolveAppUrl(),
    });
    createdId = result.messageId;
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/echanges");
  revalidatePath(`/echanges/${messageId}`);
  redirect(`/echanges/${createdId}?renvoye=1`);
}
