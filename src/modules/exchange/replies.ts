import { createHash, randomBytes } from "node:crypto";
import type { SupplierReplyAvailability } from "@/db/schema";

export const REPLY_TOKEN_BYTES = 32;
export const REPLY_TOKEN_TTL_DAYS = 90;
export const MAX_REPLIES_PER_LINK = 10;
export const MAX_AUTHOR_NAME = 120;
export const MAX_COMMENT = 2000;
export const MAX_LEAD_TIME_DAYS = 365;
export const MAX_PROPOSED_TOTAL_XOF = 2_000_000_000;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME = 200;

const REPLY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SUPPLIER_REPLY_AVAILABILITIES: readonly SupplierReplyAvailability[] = [
  "available",
  "partial",
  "unavailable",
];

export const AVAILABILITY_LABELS: Readonly<Record<SupplierReplyAvailability, string>> = {
  available: "Disponible",
  partial: "Partiellement disponible",
  unavailable: "Indisponible",
};

export type SupplierAttachmentMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface SupplierAttachment {
  readonly name: string;
  readonly mime: SupplierAttachmentMime;
  readonly size: number;
  readonly data: Uint8Array;
}

export interface SupplierReplyData {
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly availability: SupplierReplyAvailability;
  readonly comment: string | null;
  readonly leadTimeDays: number | null;
  readonly proposedTotalXof: number | null;
  readonly attachment: SupplierAttachment | null;
}

export interface SupplierReplyValidation {
  readonly data: SupplierReplyData;
  readonly errors: readonly string[];
}

export interface ReplyToken {
  readonly token: string;
  readonly hash: string;
  readonly expiresAt: Date;
}

export function hashReplyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createReplyToken(now: Date = new Date()): ReplyToken {
  const token = randomBytes(REPLY_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + REPLY_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, hash: hashReplyToken(token), expiresAt };
}

export function isReplyTokenShape(value: string): boolean {
  return REPLY_TOKEN_PATTERN.test(value);
}

export function buildReplyLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/repondre/${token}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function appendReplyLink(
  text: string,
  html: string,
  link: string,
): { readonly text: string; readonly html: string } {
  const safeLink = escapeHtml(link);
  return {
    text:
      `${text}\n\n---\n` +
      `Répondre en ligne (disponibilité, délai, prix, pièce jointe) :\n${link}\n`,
    html:
      `${html}` +
      `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e5e5;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#444">` +
      `<p style="margin:0 0 6px">Répondre en ligne : disponibilité, délai, prix et pièce jointe.</p>` +
      `<p style="margin:0"><a href="${safeLink}" style="color:#0f766e">${safeLink}</a></p>` +
      `</div>`,
  };
}

export function isSupplierReplyAvailability(value: unknown): value is SupplierReplyAvailability {
  return (
    typeof value === "string" &&
    (SUPPLIER_REPLY_AVAILABILITIES as readonly string[]).includes(value)
  );
}

function clean(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function integerField(raw: unknown, label: string, max: number, errors: string[]): number | null {
  const value = clean(raw);
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value) || Number(value) > max) {
    errors.push(`${label} : entier entre 0 et ${max.toLocaleString("fr-FR")}.`);
    return null;
  }
  return Number(value);
}

function baseName(raw: string): string {
  const name = raw.split(/[/\\]/).pop() ?? "";
  return name.trim().slice(0, MAX_ATTACHMENT_NAME);
}

function detectMime(data: Uint8Array): SupplierAttachmentMime | null {
  if (data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === "%PDF-") {
    return "application/pdf";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}

function extensionMatches(name: string, mime: SupplierAttachmentMime): boolean {
  const lower = name.toLowerCase();
  switch (mime) {
    case "application/pdf":
      return lower.endsWith(".pdf");
    case "image/png":
      return lower.endsWith(".png");
    case "image/jpeg":
      return lower.endsWith(".jpg") || lower.endsWith(".jpeg");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return lower.endsWith(".xlsx");
  }
}

export function validateSupplierAttachment(
  file: { readonly name: string; readonly data: Uint8Array } | null,
): { readonly attachment: SupplierAttachment | null; readonly errors: readonly string[] } {
  if (!file || file.data.byteLength === 0) {
    return { attachment: null, errors: [] };
  }

  const errors: string[] = [];
  const name = baseName(file.name);
  if (!name) {
    errors.push("Pièce jointe : nom de fichier invalide.");
  }
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    errors.push("Pièce jointe : 5 Mio maximum.");
  }
  const mime = detectMime(file.data);
  if (!mime) {
    errors.push("Pièce jointe : formats acceptés PDF, PNG, JPEG et XLSX.");
  } else if (name && !extensionMatches(name, mime)) {
    errors.push("Pièce jointe : le contenu ne correspond pas à l'extension du fichier.");
  }

  if (errors.length > 0 || !mime) {
    return { attachment: null, errors };
  }

  return {
    attachment: { name, mime, size: file.data.byteLength, data: file.data },
    errors,
  };
}

export function validateSupplierReply(
  raw: {
    readonly authorName?: unknown;
    readonly authorEmail?: unknown;
    readonly availability?: unknown;
    readonly comment?: unknown;
    readonly leadTimeDays?: unknown;
    readonly proposedTotalXof?: unknown;
  },
  attachment: SupplierAttachment | null,
): SupplierReplyValidation {
  const errors: string[] = [];

  const authorName = clean(raw.authorName);
  if (authorName.length < 1 || authorName.length > MAX_AUTHOR_NAME) {
    errors.push(`Nom : 1 à ${MAX_AUTHOR_NAME} caractères.`);
  }

  const emailText = clean(raw.authorEmail).toLowerCase();
  let authorEmail: string | null = null;
  if (emailText) {
    if (emailText.length > 160 || !EMAIL_PATTERN.test(emailText)) {
      errors.push("E-mail : adresse invalide.");
    } else {
      authorEmail = emailText;
    }
  }

  const availability = isSupplierReplyAvailability(raw.availability) ? raw.availability : null;
  if (!availability) {
    errors.push("Disponibilité : choisissez disponible, partiellement disponible ou indisponible.");
  }

  const comment = clean(raw.comment);
  if (comment.length > MAX_COMMENT) {
    errors.push(`Commentaire : ${MAX_COMMENT} caractères maximum.`);
  }
  if (!comment && availability && availability !== "available") {
    errors.push(
      "Commentaire : précisez le motif quand la commande n'est pas entièrement disponible.",
    );
  }

  const leadTimeDays = integerField(
    raw.leadTimeDays,
    "Délai proposé (jours)",
    MAX_LEAD_TIME_DAYS,
    errors,
  );
  const proposedTotalXof = integerField(
    raw.proposedTotalXof,
    "Montant total proposé (XOF)",
    MAX_PROPOSED_TOTAL_XOF,
    errors,
  );

  return {
    data: {
      authorName,
      authorEmail,
      availability: availability ?? "available",
      comment: comment || null,
      leadTimeDays,
      proposedTotalXof,
      attachment,
    },
    errors,
  };
}
