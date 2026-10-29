import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { parseXofPrice } from "@/modules/shared/validation";
import {
  compareQuantity,
  computeLineTotal,
  isZeroQuantity,
  parseQuantity,
} from "@/modules/stock/quantities";

export const MAX_QUOTE_AUTHOR_NAME = 120;
export const MAX_QUOTE_COMMENT = 2000;
export const MAX_QUOTE_LEAD_TIME_DAYS = 365;
export const MAX_QUOTE_REVISIONS = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestedTenderLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly qty: string;
}

export interface TenderQuoteLineInput {
  readonly tenderLineId: string;
  readonly qty: unknown;
  readonly unitPriceXof: unknown;
}

export interface TenderQuoteRaw {
  readonly authorName: unknown;
  readonly authorEmail: unknown;
  readonly leadTimeDays: unknown;
  readonly comment: unknown;
  readonly declined: unknown;
  readonly honeypot: unknown;
  readonly lines: readonly TenderQuoteLineInput[];
}

export interface ValidatedQuoteLine {
  readonly tenderLineId: string;
  readonly proposedQty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface ValidatedTenderQuote {
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly leadTimeDays: number | null;
  readonly comment: string | null;
  readonly declined: boolean;
  readonly lines: readonly ValidatedQuoteLine[];
  readonly totalXof: number;
}

function text(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function isChecked(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on" || raw === "1";
}

export function validateTenderQuote(
  raw: TenderQuoteRaw,
  requested: readonly RequestedTenderLine[],
): { quote: ValidatedTenderQuote | null; errors: string[] } {
  const errors: string[] = [];

  if (text(raw.honeypot)) {
    return { quote: null, errors: ["Cotation refusée."] };
  }

  const authorName = text(raw.authorName);
  if (authorName.length < 1 || authorName.length > MAX_QUOTE_AUTHOR_NAME) {
    errors.push(`Nom : 1 à ${MAX_QUOTE_AUTHOR_NAME} caractères.`);
  }

  const emailText = text(raw.authorEmail).toLowerCase();
  let authorEmail: string | null = null;
  if (emailText) {
    if (emailText.length > 160 || !EMAIL_PATTERN.test(emailText)) {
      errors.push("E-mail : adresse invalide.");
    } else {
      authorEmail = emailText;
    }
  }

  const leadText = text(raw.leadTimeDays);
  let leadTimeDays: number | null = null;
  if (leadText) {
    if (!/^\d+$/.test(leadText) || Number(leadText) > MAX_QUOTE_LEAD_TIME_DAYS) {
      errors.push(`Délai : entier entre 0 et ${MAX_QUOTE_LEAD_TIME_DAYS} jours.`);
    } else {
      leadTimeDays = Number(leadText);
    }
  }

  const comment = text(raw.comment);
  if (comment.length > MAX_QUOTE_COMMENT) {
    errors.push(`Commentaire : ${MAX_QUOTE_COMMENT} caractères maximum.`);
  }

  const declined = isChecked(raw.declined);
  if (declined) {
    if (!comment) {
      errors.push("Commentaire : précisez le motif du refus.");
    }
    if (errors.length > 0) {
      return { quote: null, errors };
    }
    return {
      quote: {
        authorName,
        authorEmail,
        leadTimeDays,
        comment,
        declined: true,
        lines: [],
        totalXof: 0,
      },
      errors,
    };
  }

  if (requested.length < 1) {
    errors.push("Cette demande ne contient aucune ligne.");
  }

  const requestedById = new Map(requested.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const lines: ValidatedQuoteLine[] = [];

  for (const input of raw.lines) {
    if (!UUID_PATTERN.test(input.tenderLineId) || !requestedById.has(input.tenderLineId)) {
      errors.push("Ligne : référence inconnue.");
      continue;
    }
    if (seen.has(input.tenderLineId)) {
      errors.push("Ligne : renseignée deux fois.");
      continue;
    }
    seen.add(input.tenderLineId);
    const requestedLine = requestedById.get(input.tenderLineId)!;

    const qty = parseQuantity(input.qty, "Quantité proposée", { allowZero: true });
    errors.push(...qty.errors);
    if (!qty.value) {
      continue;
    }
    if (compareQuantity(qty.value, requestedLine.qty) > 0) {
      errors.push("Quantité proposée : supérieure à la quantité demandée.");
      continue;
    }

    const priceText = text(input.unitPriceXof);
    if (!priceText) {
      if (!isZeroQuantity(qty.value)) {
        errors.push("Prix unitaire : obligatoire pour une ligne proposée.");
        continue;
      }
      lines.push({
        tenderLineId: input.tenderLineId,
        proposedQty: qty.value,
        unitPriceXof: 0,
        lineTotalXof: 0,
      });
      continue;
    }

    const price = parseXofPrice(input.unitPriceXof, "Prix unitaire");
    errors.push(...price.errors);
    if (price.errors.length > 0) {
      continue;
    }
    if (isZeroQuantity(qty.value) && price.value > 0) {
      errors.push("Prix unitaire : retirez le prix d'une ligne non proposée.");
      continue;
    }
    if (!isZeroQuantity(qty.value) && price.value === 0) {
      errors.push("Prix unitaire : strictement positif pour une ligne proposée.");
      continue;
    }

    lines.push({
      tenderLineId: input.tenderLineId,
      proposedQty: qty.value,
      unitPriceXof: price.value,
      lineTotalXof: computeLineTotal(qty.value, price.value),
    });
  }

  for (const line of requested) {
    if (!seen.has(line.id)) {
      errors.push(`Ligne ${line.lineNumber} : renseignez 0 si vous ne la proposez pas.`);
    }
  }

  const offered = lines.filter((line) => !isZeroQuantity(line.proposedQty));
  if (offered.length === 0) {
    errors.push("Indiquez au moins une ligne proposée, ou refusez la demande.");
  }

  const totalXof = lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
  if (totalXof > MAX_XOF_AMOUNT) {
    errors.push(`Total : ${MAX_XOF_AMOUNT} XOF maximum.`);
  }

  if (errors.length > 0) {
    return { quote: null, errors };
  }

  return {
    quote: {
      authorName,
      authorEmail,
      leadTimeDays,
      comment: comment || null,
      declined: false,
      lines,
      totalXof,
    },
    errors,
  };
}
