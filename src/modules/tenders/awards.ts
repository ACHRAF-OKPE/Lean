import { compareQuantity, isZeroQuantity } from "@/modules/stock/quantities";
import { MAX_TENDER_MOTIVE } from "./rules";

export interface TenderOffer {
  readonly tenderLineId: string;
  readonly quoteId: string;
  readonly quoteLineId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly revision: number;
  readonly proposedQty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
  readonly leadTimeDays: number | null;
  readonly submittedAt: Date;
}

function text(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function sortTenderOffers(offers: readonly TenderOffer[]): TenderOffer[] {
  return [...offers].sort((left, right) => {
    if (left.unitPriceXof !== right.unitPriceXof) {
      return left.unitPriceXof - right.unitPriceXof;
    }
    const leftLead = left.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    const rightLead = right.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    if (leftLead !== rightLead) {
      return leftLead - rightLead;
    }
    const submitted = left.submittedAt.getTime() - right.submittedAt.getTime();
    if (submitted !== 0) {
      return submitted;
    }
    return left.supplierName.localeCompare(right.supplierName, "fr");
  });
}

export function offersByLine(offers: readonly TenderOffer[]): Map<string, TenderOffer[]> {
  const grouped = new Map<string, TenderOffer[]>();
  for (const offer of offers) {
    if (isZeroQuantity(offer.proposedQty)) {
      continue;
    }
    const list = grouped.get(offer.tenderLineId);
    if (list) {
      list.push(offer);
    } else {
      grouped.set(offer.tenderLineId, [offer]);
    }
  }
  for (const [lineId, list] of grouped) {
    grouped.set(lineId, sortTenderOffers(list));
  }
  return grouped;
}

export function bestOffer(
  offers: readonly TenderOffer[],
  tenderLineId: string,
): TenderOffer | null {
  return offersByLine(offers).get(tenderLineId)?.[0] ?? null;
}

export interface AwardCheckInput {
  readonly offer: TenderOffer;
  readonly cheapest: TenderOffer | null;
  readonly requestedQty: string;
  readonly motive: unknown;
}

export function validateTenderAward(input: AwardCheckInput): {
  readonly motive: string | null;
  readonly errors: string[];
} {
  const errors: string[] = [];
  const motive = text(input.motive);

  if (isZeroQuantity(input.offer.proposedQty)) {
    errors.push("Cette ligne n'est pas proposée par le fournisseur.");
  }
  if (compareQuantity(input.offer.proposedQty, input.requestedQty) > 0) {
    errors.push("Quantité attribuée : supérieure à la quantité demandée.");
  }
  if (motive.length > MAX_TENDER_MOTIVE) {
    errors.push(`Motif : ${MAX_TENDER_MOTIVE} caractères maximum.`);
  }

  const cheapest = input.cheapest;
  if (cheapest && input.offer.unitPriceXof > cheapest.unitPriceXof) {
    if (motive.length < 1) {
      errors.push(
        `Motif : obligatoire car le prix retenu dépasse le meilleur prix (${cheapest.unitPriceXof} XOF).`,
      );
    }
  }

  return { motive: motive || null, errors };
}

export interface TenderLineState {
  readonly id: string;
  readonly rejected: boolean;
}

export function remainingTenderLines(
  lines: readonly TenderLineState[],
  awardedLineIds: ReadonlySet<string>,
): readonly TenderLineState[] {
  return lines.filter((line) => !line.rejected && !awardedLineIds.has(line.id));
}

export function isTenderFullyResolved(
  lines: readonly TenderLineState[],
  awardedLineIds: ReadonlySet<string>,
): boolean {
  return remainingTenderLines(lines, awardedLineIds).length === 0;
}
