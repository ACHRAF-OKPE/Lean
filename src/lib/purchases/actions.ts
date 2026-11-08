"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { resolveAppUrl } from "@/lib/app-url";
import { PurchaseError } from "@/modules/purchases/errors";
import type { PurchaseAction } from "@/modules/purchases/lifecycle";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { savePurchaseSettings } from "@/modules/purchases/settings";
import { defaultTransportFactory } from "@/modules/exchange/mailer";
import { getEmailAccountConfig, getPurchaseOrderSignaturePdf } from "@/modules/exchange/queries";
import { getCurrentPurchaseSigner } from "@/modules/purchases/signatures";
import { purchaseSettings, users } from "@/db/schema";
import {
  confirmPurchaseSignature,
  getLatestConfirmedPurchaseSignatureFile,
  markPurchaseSignerNotified,
  startPurchaseSignatureChain,
  uploadPurchaseSignature,
} from "@/modules/purchases/signatures";
import { StockError } from "@/modules/stock/errors";
import { cancelReception, createReception } from "@/modules/stock/receptions";
import type { PurchaseFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURCHASE_ACTIONS: readonly PurchaseAction[] = ["request", "confirm", "close", "cancel"];

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): PurchaseFormState {
  if (error instanceof PurchaseError || error instanceof StockError) {
    return { errors: [error.message] };
  }
  throw error;
}

async function notifyCurrentSigner(
  tenantId: string,
  orderId: string,
  actorUserId: string,
): Promise<string | null> {
  const notice = await getCurrentPurchaseSigner(getDb(), { tenantId, orderId });
  if (!notice) return null;
  const account = await getEmailAccountConfig(getDb(), tenantId);
  if (!account?.active)
    return "Circuit créé, mais aucun compte d'envoi actif ne peut notifier le signataire.";
  const url = `${await resolveAppUrl()}/achats/${orderId}`;
  try {
    const pdf = await getPurchaseOrderSignaturePdf(getDb(), { tenantId, orderId });
    const latestSignature = await getLatestConfirmedPurchaseSignatureFile(getDb(), {
      tenantId,
      orderId,
      beforeSequence: notice.sequence,
    });
    await defaultTransportFactory(account.config).send({
      to: notice.signerEmail,
      toName: notice.signerName,
      subject: `Signature requise — ${notice.orderNumber}`,
      text: `Bonjour ${notice.signerName},\n\nLe bon de commande ${notice.orderNumber} vous attend pour signature (étape ${notice.sequence}). Ouvrez la commande, déposez le PDF signé puis confirmez explicitement le dépôt : ${url}\n\nLe prochain signataire ne sera notifié qu'après votre confirmation.`,
      html: `<p>Bonjour ${notice.signerName},</p><p>Le bon de commande <strong>${notice.orderNumber}</strong> vous attend pour signature (étape ${notice.sequence}).</p><p><a href="${url}">Ouvrir la commande, déposer le PDF signé et confirmer le dépôt</a></p><p>Le prochain signataire ne sera notifié qu'après votre confirmation.</p>`,
      attachments: [
        {
          filename: latestSignature?.fileName ?? pdf.fileName,
          content: latestSignature?.data ?? pdf.data,
          contentType: "application/pdf",
        },
      ],
    });
    await markPurchaseSignerNotified(getDb(), {
      tenantId,
      orderId,
      signatureId: notice.signatureId,
      actorUserId,
    });
    return null;
  } catch {
    return "Le circuit est en place, mais le courriel au signataire n'a pas pu partir. Un gestionnaire peut relancer la notification.";
  }
}

/** PUR-014 — notifier le validateur qu'une demande de validation l'attend. */
async function notifyValidator(
  tenantId: string,
  orderId: string,
  orderNumber: string | null,
): Promise<string | null> {
  const [settings] = await getDb()
    .select({ validatorUserId: purchaseSettings.validatorUserId })
    .from(purchaseSettings)
    .where(eq(purchaseSettings.tenantId, tenantId))
    .limit(1);
  if (!settings?.validatorUserId) return null;

  const [validator] = await getDb()
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, settings.validatorUserId))
    .limit(1);
  if (!validator?.email) return null;

  const account = await getEmailAccountConfig(getDb(), tenantId);
  if (!account?.active)
    return "Demande créée, mais aucun compte d'envoi actif ne peut notifier le validateur.";

  const url = `${await resolveAppUrl()}/achats/${orderId}`;
  try {
    await defaultTransportFactory(account.config).send({
      to: validator.email,
      toName: validator.name,
      subject: `Validation requise — commande fournisseur ${orderNumber ?? orderId}`,
      text: `Bonjour ${validator.name},\n\nUne commande fournisseur vous attend pour validation. Ouvrez la commande pour la confirmer : ${url}\n\nCette tâche vous est personnellement assignée.`,
      html: `<p>Bonjour ${validator.name},</p><p>Une commande fournisseur vous attend pour validation.</p><p><a href="${url}">Ouvrir la commande et confirmer</a></p><p>Cette tâche vous est personnellement assignée.</p>`,
      attachments: [],
    });
    return null;
  } catch {
    return "La demande est créée, mais le courriel au validateur n'a pas pu partir.";
  }
}

export async function createPurchaseOrderAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "write");
  const articleIds = formData.getAll("articleId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const prices = formData.getAll("prix_unitaire_xof").map(String);
  const rowCount = Math.max(articleIds.length, quantities.length, prices.length);
  const lines = Array.from({ length: rowCount }, (_, index) => ({
    articleId: articleIds[index] ?? "",
    qty: quantities[index] ?? "",
    unitPriceXof: prices[index] ?? "",
  })).filter(
    (line) =>
      line.articleId.trim() !== "" || line.qty.trim() !== "" || line.unitPriceXof.trim() !== "",
  );

  let createdId: string;
  try {
    const created = await createPurchaseOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: {
        supplierId: text(formData, "supplierId"),
        expectedReceiptDate: text(formData, "expectedReceiptDate"),
        externalReference: text(formData, "externalReference"),
        notes: text(formData, "notes"),
        lines,
      },
      legalClauses: text(formData, "legalClauses"),
    });
    createdId = created.id;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${createdId}?cree=1`);
}

export async function transitionPurchaseOrderAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "manage");
  const orderId = text(formData, "orderId");
  const requested = text(formData, "action") as PurchaseAction;

  if (!UUID_PATTERN.test(orderId)) {
    return { errors: ["Commande invalide."] };
  }
  if (!PURCHASE_ACTIONS.includes(requested)) {
    return { errors: ["Action inconnue."] };
  }

  let status: string;
  try {
    const result = await transitionPurchaseOrder(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      action: requested,
    });
    if (requested === "request") {
      const notificationError = await notifyValidator(session.tenantId, orderId, result.number);
      if (notificationError) return { errors: [notificationError] };
    }
    if (result.signatureWorkflowStarted) {
      const notificationError = await notifyCurrentSigner(
        session.tenantId,
        orderId,
        session.userId,
      );
      if (notificationError) return { errors: [notificationError] };
    }
    status = result.status;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${orderId}?maj=${status}`);
}

export async function createReceptionAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("stock", "write");
  const orderId = text(formData, "orderId");
  const locationId = text(formData, "locationId");

  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(locationId)) {
    return { errors: ["Commande ou emplacement invalide."] };
  }

  const orderLineIds = formData.getAll("orderLineId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const lines = orderLineIds.map((orderLineId, index) => ({
    orderLineId,
    qty: quantities[index] ?? "",
  }));

  let number: string;
  let warningCount: number;
  try {
    const result = await createReception(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      orderId,
      locationId,
      receivedDate: text(formData, "receivedDate"),
      notes: text(formData, "notes"),
      lines,
    });
    number = result.number;
    warningCount = result.warnings.length;
  } catch (error) {
    return failure(error);
  }

  const warningParam = warningCount > 0 ? `&avertissements=${warningCount}` : "";
  redirect(`/achats/${orderId}?recu=${encodeURIComponent(number)}${warningParam}`);
}

export async function cancelReceptionAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("stock", "manage");
  const receptionId = text(formData, "receptionId");
  const orderId = text(formData, "orderId");

  if (!UUID_PATTERN.test(receptionId) || !UUID_PATTERN.test(orderId)) {
    return { errors: ["Réception invalide."] };
  }

  let number: string;
  try {
    const result = await cancelReception(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      receptionId,
    });
    number = result.number;
  } catch (error) {
    return failure(error);
  }

  redirect(`/achats/${orderId}?annulee=${encodeURIComponent(number)}`);
}

export async function savePurchaseSettingsAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "manage");

  try {
    await savePurchaseSettings(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        defaultReceiptDelayDays: text(formData, "defaultReceiptDelayDays"),
        signerUserIds: formData.getAll("signerUserId"),
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/achats/parametres?enregistre=1");
}

export async function startPurchaseSignatureChainAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "manage");
  const orderId = text(formData, "orderId");
  if (!UUID_PATTERN.test(orderId)) return { errors: ["Commande invalide."] };
  try {
    await startPurchaseSignatureChain(getDb(), { tenantId: session.tenantId, orderId });
    const notificationError = await notifyCurrentSigner(session.tenantId, orderId, session.userId);
    if (notificationError) return { errors: [notificationError] };
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/${orderId}?signatures=lancees`);
}

export async function resendPurchaseSignatureNoticeAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "manage");
  const orderId = text(formData, "orderId");
  if (!UUID_PATTERN.test(orderId)) return { errors: ["Commande invalide."] };
  const notificationError = await notifyCurrentSigner(session.tenantId, orderId, session.userId);
  if (notificationError) return { errors: [notificationError] };
  redirect(`/achats/${orderId}?signatures=notification-renvoyee`);
}

export async function uploadPurchaseSignatureAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "read");
  const orderId = text(formData, "orderId");
  const file = formData.get("signedPo");
  if (!UUID_PATTERN.test(orderId) || !(file instanceof File)) {
    return { errors: ["Commande ou fichier signé invalide."] };
  }
  try {
    await uploadPurchaseSignature(getDb(), {
      tenantId: session.tenantId,
      orderId,
      actorUserId: session.userId,
      fileName: file.name,
      mime: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/${orderId}?signatures=deposees`);
}

export async function confirmPurchaseSignatureAction(
  _state: PurchaseFormState,
  formData: FormData,
): Promise<PurchaseFormState> {
  const session = await requireModule("purchases", "read");
  const orderId = text(formData, "orderId");
  if (!UUID_PATTERN.test(orderId)) return { errors: ["Commande invalide."] };
  if (formData.get("confirmSignedPo") !== "on") {
    return { errors: ["Confirmez que vous avez vérifié le PO signé avant de le transmettre."] };
  }
  try {
    const result = await confirmPurchaseSignature(getDb(), {
      tenantId: session.tenantId,
      orderId,
      actorUserId: session.userId,
    });
    if (result.nextSigner) {
      const notificationError = await notifyCurrentSigner(
        session.tenantId,
        orderId,
        session.userId,
      );
      if (notificationError) return { errors: [notificationError] };
    }
    redirect(`/achats/${orderId}?signatures=${result.complete ? "terminees" : "suivante"}`);
  } catch (error) {
    return failure(error);
  }
}
