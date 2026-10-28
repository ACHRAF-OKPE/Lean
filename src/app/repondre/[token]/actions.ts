"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { SupplierReplyFormState } from "@/lib/exchange/reply-form-state";
import { ExchangeError } from "@/modules/exchange/errors";
import { createSupplierReply } from "@/modules/exchange/reply-queries";
import {
  MAX_ATTACHMENT_BYTES,
  isReplyTokenShape,
  validateSupplierAttachment,
  validateSupplierReply,
} from "@/modules/exchange/replies";

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function submitSupplierReplyAction(
  _state: SupplierReplyFormState,
  formData: FormData,
): Promise<SupplierReplyFormState> {
  void _state;

  if (text(formData, "website")) {
    return { errors: ["Réponse refusée."] };
  }

  const token = text(formData, "token") ?? "";
  if (!isReplyTokenShape(token)) {
    return { errors: ["Ce lien de réponse n'est plus actif."] };
  }

  const file = formData.get("attachment");
  let attachmentFile: { readonly name: string; readonly data: Uint8Array } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { errors: ["Pièce jointe : 5 Mio maximum."] };
    }
    attachmentFile = { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
  }

  const attachmentCheck = validateSupplierAttachment(attachmentFile);
  if (attachmentCheck.errors.length > 0) {
    return { errors: attachmentCheck.errors };
  }

  const validation = validateSupplierReply(
    {
      authorName: text(formData, "authorName"),
      authorEmail: text(formData, "authorEmail"),
      availability: text(formData, "availability"),
      comment: text(formData, "comment"),
      leadTimeDays: text(formData, "leadTimeDays"),
      proposedTotalXof: text(formData, "proposedTotalXof"),
    },
    attachmentCheck.attachment,
  );
  if (validation.errors.length > 0) {
    return { errors: validation.errors };
  }

  try {
    const result = await createSupplierReply(getDb(), { token, data: validation.data });
    revalidatePath(`/achats/${result.orderId}`);
    revalidatePath("/notifications");
  } catch (error) {
    if (error instanceof ExchangeError) {
      return { errors: [error.message] };
    }
    throw error;
  }

  return { errors: [], done: true };
}
