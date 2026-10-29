import { createHash, randomBytes } from "node:crypto";
import type { TenderInvitationStatus, TenderStatus } from "@/db/schema";
import { parseIsoDate } from "@/modules/shared/validation";
import { parseQuantity } from "@/modules/stock/quantities";

export const MAX_TENDER_TITLE = 120;
export const MAX_TENDER_NOTES = 2000;
export const MAX_TENDER_LINE_NOTE = 500;
export const MAX_TENDER_LINES = 100;
export const MAX_TENDER_SUPPLIERS = 50;
export const MAX_TENDER_MOTIVE = 500;
export const TENDER_TOKEN_BYTES = 32;

const TENDER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TENDER_STATUS_LABELS: Readonly<Record<TenderStatus, string>> = {
  draft: "Brouillon",
  open: "Ouverte",
  awarded: "Attribuée",
  cancelled: "Annulée",
};

export const INVITATION_STATUS_LABELS: Readonly<Record<TenderInvitationStatus, string>> = {
  pending: "À envoyer",
  sent: "Envoyée",
  quoted: "Cotée",
  declined: "Refusée",
};

export function tenderStatusLabel(status: TenderStatus): string {
  return TENDER_STATUS_LABELS[status];
}

export function isTenderStatus(value: string): value is TenderStatus {
  return value in TENDER_STATUS_LABELS;
}

export interface DraftTenderLineInput {
  readonly articleId: string;
  readonly qty: unknown;
  readonly requestedDate: unknown;
  readonly note: unknown;
}

export interface DraftTenderInput {
  readonly title: unknown;
  readonly deadline: unknown;
  readonly notes: unknown;
  readonly lines: readonly DraftTenderLineInput[];
  readonly supplierIds: readonly string[];
}

export interface ValidatedTenderLine {
  readonly articleId: string;
  readonly qty: string;
  readonly requestedDate: string | null;
  readonly note: string | null;
}

export interface ValidatedTenderDraft {
  readonly title: string;
  readonly deadline: string;
  readonly notes: string | null;
  readonly lines: readonly ValidatedTenderLine[];
  readonly supplierIds: readonly string[];
}

function text(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function validateTenderDraft(
  input: DraftTenderInput,
  todayIso: string,
): { draft: ValidatedTenderDraft | null; errors: string[] } {
  const errors: string[] = [];

  const title = text(input.title);
  if (title.length < 1 || title.length > MAX_TENDER_TITLE) {
    errors.push(`Intitulé : 1 à ${MAX_TENDER_TITLE} caractères.`);
  }

  const deadline = parseIsoDate(input.deadline, "Échéance", true);
  errors.push(...deadline.errors);
  if (deadline.value && deadline.value < todayIso) {
    errors.push("Échéance : aujourd'hui ou une date future attendue.");
  }

  const notes = text(input.notes);
  if (notes.length > MAX_TENDER_NOTES) {
    errors.push(`Note : ${MAX_TENDER_NOTES} caractères maximum.`);
  }

  if (input.lines.length < 1) {
    errors.push("Ajoutez au moins une ligne de besoin.");
  }
  if (input.lines.length > MAX_TENDER_LINES) {
    errors.push(`${MAX_TENDER_LINES} lignes de besoin au maximum.`);
  }

  const lines: ValidatedTenderLine[] = [];
  input.lines.forEach((line, index) => {
    const label = `Ligne ${index + 1}`;
    if (!UUID_PATTERN.test(line.articleId)) {
      errors.push(`${label} : article requis.`);
    }
    const qty = parseQuantity(line.qty, `${label} : quantité`);
    errors.push(...qty.errors);
    const requestedDate = parseIsoDate(line.requestedDate, `${label} : date souhaitée`);
    errors.push(...requestedDate.errors);
    const note = text(line.note);
    if (note.length > MAX_TENDER_LINE_NOTE) {
      errors.push(`${label} : note de ${MAX_TENDER_LINE_NOTE} caractères maximum.`);
    }
    if (UUID_PATTERN.test(line.articleId) && qty.value) {
      lines.push({
        articleId: line.articleId,
        qty: qty.value,
        requestedDate: requestedDate.value,
        note: note || null,
      });
    }
  });

  if (input.supplierIds.length < 1) {
    errors.push("Invitez au moins un fournisseur.");
  }
  if (input.supplierIds.length > MAX_TENDER_SUPPLIERS) {
    errors.push(`${MAX_TENDER_SUPPLIERS} fournisseurs invités au maximum.`);
  }
  const supplierIds: string[] = [];
  input.supplierIds.forEach((supplierId, index) => {
    if (!UUID_PATTERN.test(supplierId)) {
      errors.push(`Fournisseur ${index + 1} : référence invalide.`);
      return;
    }
    if (supplierIds.includes(supplierId)) {
      errors.push(`Fournisseur ${index + 1} : invité deux fois.`);
      return;
    }
    supplierIds.push(supplierId);
  });

  if (errors.length > 0) {
    return { draft: null, errors };
  }

  return {
    draft: {
      title,
      deadline: deadline.value ?? todayIso,
      notes: notes || null,
      lines,
      supplierIds,
    },
    errors,
  };
}

export function hashTenderToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTenderToken(expiresAt: Date): {
  readonly token: string;
  readonly hash: string;
  readonly expiresAt: Date;
} {
  const token = randomBytes(TENDER_TOKEN_BYTES).toString("base64url");
  return { token, hash: hashTenderToken(token), expiresAt };
}

export function isTenderTokenShape(value: string): boolean {
  return TENDER_TOKEN_PATTERN.test(value);
}

export function tenderTokenExpiry(deadlineIso: string): Date {
  return new Date(`${deadlineIso}T23:59:59.999Z`);
}

export function buildQuoteLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/cotations/${token}`;
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

export interface TenderEmailInput {
  readonly companyName: string;
  readonly number: string;
  readonly title: string;
  readonly deadlineLabel: string;
  readonly lines: readonly {
    readonly lineNumber: number;
    readonly name: string;
    readonly qty: string;
    readonly unitCode: string;
  }[];
  readonly link: string;
}

export function renderTenderEmail(input: TenderEmailInput): {
  readonly text: string;
  readonly html: string;
} {
  const lineText = input.lines
    .map(
      (line) =>
        `${String(line.lineNumber).padStart(2, "0")}. ${line.name} — ${line.qty} ${line.unitCode}`,
    )
    .join("\n");
  const text =
    `${input.companyName} vous invite à coter la demande de cotation ${input.number} — ${input.title}.\n` +
    `Échéance : ${input.deadlineLabel}.\n\n` +
    `Lignes demandées :\n${lineText}\n\n` +
    `Déposer votre cotation en ligne (prix, disponibilité et délai) :\n${input.link}\n\n` +
    `Ce lien est personnel : ne le transférez pas.\n`;

  const lineHtml = input.lines
    .map(
      (line) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;font-family:monospace">${String(line.lineNumber).padStart(2, "0")}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(line.name)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${escapeHtml(line.qty)} ${escapeHtml(line.unitCode)}</td></tr>`,
    )
    .join("");
  const safeLink = escapeHtml(input.link);
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#222">` +
    `<p>${escapeHtml(input.companyName)} vous invite à coter la demande de cotation <strong>${escapeHtml(input.number)}</strong> — ${escapeHtml(input.title)}.</p>` +
    `<p>Échéance : <strong>${escapeHtml(input.deadlineLabel)}</strong>.</p>` +
    `<table style="border-collapse:collapse;margin:8px 0">${lineHtml}</table>` +
    `<p>Déposer votre cotation en ligne (prix, disponibilité et délai) :</p>` +
    `<p><a href="${safeLink}" style="color:#0f766e">${safeLink}</a></p>` +
    `<p style="color:#666;font-size:12px">Ce lien est personnel : ne le transférez pas.</p>` +
    `</div>`;

  return { text, html };
}
