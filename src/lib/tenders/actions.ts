"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { resolveAppUrl } from "@/lib/app-url";
import { requirePermission } from "@/lib/auth/session";
import { SequenceError } from "@/modules/stock/sequences";
import { TenderError } from "@/modules/tenders/errors";
import { getPublicTender, submitTenderQuote } from "@/modules/tenders/quote-queries";
import {
  awardTenderLine,
  cancelTender,
  createTenderDraft,
  deleteTenderDraft,
  generateTenderPurchaseOrders,
  rejectTenderLine,
  resendTenderInvitation,
  sendTender,
  updateTenderDraft,
} from "@/modules/tenders/queries";
import type { DraftTenderInput } from "@/modules/tenders/rules";
import type { TenderFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): TenderFormState {
  if (error instanceof TenderError || error instanceof SequenceError) {
    return { errors: error.message.split("\n") };
  }
  throw error;
}

function parseDraft(formData: FormData): DraftTenderInput {
  const articleIds = formData.getAll("articleId").map(String);
  const quantities = formData.getAll("quantite").map(String);
  const requestedDates = formData.getAll("date_souhaitee").map(String);
  const notes = formData.getAll("note_ligne").map(String);
  const rowCount = Math.max(
    articleIds.length,
    quantities.length,
    requestedDates.length,
    notes.length,
  );
  const lines = Array.from({ length: rowCount }, (_, index) => ({
    articleId: articleIds[index] ?? "",
    qty: quantities[index] ?? "",
    requestedDate: requestedDates[index] ?? "",
    note: notes[index] ?? "",
  })).filter(
    (line) =>
      line.articleId.trim() !== "" ||
      line.qty.trim() !== "" ||
      line.requestedDate.trim() !== "" ||
      line.note.trim() !== "",
  );

  const supplierIds = [...new Set(formData.getAll("supplierId").map(String))].filter(
    (value) => value.trim() !== "",
  );

  return {
    title: text(formData, "title"),
    deadline: text(formData, "deadline"),
    notes: text(formData, "notes"),
    lines,
    supplierIds,
  };
}

export async function createTenderAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  let createdId: string;
  try {
    const created = await createTenderDraft(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      data: parseDraft(formData),
    });
    createdId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${createdId}?cree=1`);
}

export async function updateTenderAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  if (!UUID_PATTERN.test(tenderId)) {
    return { errors: ["Demande invalide."] };
  }
  try {
    await updateTenderDraft(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      data: parseDraft(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?maj=1`);
}

export async function deleteTenderAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  if (!UUID_PATTERN.test(tenderId)) {
    return { errors: ["Demande invalide."] };
  }
  try {
    await deleteTenderDraft(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/achats/appels-offres?supprimee=1");
}

export async function sendTenderAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  if (!UUID_PATTERN.test(tenderId)) {
    return { errors: ["Demande invalide."] };
  }
  let result: Awaited<ReturnType<typeof sendTender>>;
  try {
    result = await sendTender(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      appUrl: await resolveAppUrl(),
    });
  } catch (error) {
    return failure(error);
  }
  const params = new URLSearchParams({ envoye: result.number, livres: String(result.delivered) });
  if (result.failures.length > 0) {
    params.set("echecs", String(result.failures.length));
  }
  redirect(`/achats/appels-offres/${tenderId}?${params.toString()}`);
}

export async function resendInvitationAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  const invitationId = text(formData, "invitationId");
  if (!UUID_PATTERN.test(tenderId) || !UUID_PATTERN.test(invitationId)) {
    return { errors: ["Invitation invalide."] };
  }
  let supplierName: string;
  try {
    const result = await resendTenderInvitation(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      invitationId,
      appUrl: await resolveAppUrl(),
    });
    supplierName = result.supplierName;
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?renvoye=${encodeURIComponent(supplierName)}`);
}

export async function cancelTenderAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  if (!UUID_PATTERN.test(tenderId)) {
    return { errors: ["Demande invalide."] };
  }
  try {
    await cancelTender(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?annulee=1`);
}

export async function awardTenderLineAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  const quoteLineId = text(formData, "quoteLineId");
  if (!UUID_PATTERN.test(tenderId) || !UUID_PATTERN.test(quoteLineId)) {
    return { errors: ["Offre invalide."] };
  }
  try {
    await awardTenderLine(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      quoteLineId,
      motive: text(formData, "motive"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?attribue=1`);
}

export async function rejectTenderLineAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  const tenderLineId = text(formData, "tenderLineId");
  if (!UUID_PATTERN.test(tenderId) || !UUID_PATTERN.test(tenderLineId)) {
    return { errors: ["Ligne invalide."] };
  }
  try {
    await rejectTenderLine(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
      tenderLineId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?ecartee=1`);
}

export async function generateTenderOrdersAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const session = await requirePermission("data.write");
  const tenderId = text(formData, "tenderId");
  if (!UUID_PATTERN.test(tenderId)) {
    return { errors: ["Demande invalide."] };
  }
  let orderCount: number;
  try {
    const result = await generateTenderPurchaseOrders(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      tenderId,
    });
    orderCount = result.orderIds.length;
  } catch (error) {
    return failure(error);
  }
  redirect(`/achats/appels-offres/${tenderId}?commandes=${orderCount}`);
}

export async function submitTenderQuoteAction(
  _state: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const token = text(formData, "token");
  if (token.length < 1 || token.length > 200) {
    return { errors: ["Lien de cotation invalide."] };
  }

  const db = getDb();
  const context = await getPublicTender(db, token);
  if (!context) {
    return { errors: ["Ce lien de cotation n'est plus actif."] };
  }

  const lines = context.lines.map((line) => ({
    tenderLineId: line.id,
    qty: text(formData, `qty-${line.lineNumber}`),
    unitPriceXof: text(formData, `price-${line.lineNumber}`),
  }));

  try {
    await submitTenderQuote(db, {
      token,
      data: {
        authorName: text(formData, "authorName"),
        authorEmail: text(formData, "authorEmail"),
        leadTimeDays: text(formData, "leadTimeDays"),
        comment: text(formData, "comment"),
        declined: formData.get("declined"),
        honeypot: text(formData, "company_website"),
        lines,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/cotations/${token}?deposee=1`);
}
