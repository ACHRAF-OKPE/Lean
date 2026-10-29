import type { CustomsApurementMode, CustomsDeclarationStatus } from "@/db/schema";
import { microsToQuantity, quantityToMicros } from "@/modules/stock/quantities";

export type ApurementLineState = "open" | "partial" | "apured";
export type ApurementDeclarationState = "not_required" | "open" | "partial" | "apured";

const MODE_ALIASES: Record<string, CustomsApurementMode> = {
  production: "production",
  export: "export",
  exportation: "export",
  destruction: "destruction",
  transfer: "transfer",
  transfert: "transfer",
};

export function normalizeApurementMode(raw: unknown): CustomsApurementMode | null {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return MODE_ALIASES[text] ?? null;
}

export interface LineApurementProgress {
  readonly apuredQuantity: string;
  readonly remainingQuantity: string;
  readonly rateBp: number;
  readonly state: ApurementLineState;
}

export function lineApurementProgress(
  declaredQuantity: string,
  apuredQuantity: string,
): LineApurementProgress {
  const declared = quantityToMicros(declaredQuantity);
  const apured = quantityToMicros(apuredQuantity);
  const remaining = declared - apured;
  const rateBp = declared === 0n ? 0 : Number((apured * 10_000n) / declared);
  if (remaining <= 0n) {
    return {
      apuredQuantity: apured > declared ? declaredQuantity : apuredQuantity,
      remainingQuantity: "0",
      rateBp: 10_000,
      state: "apured",
    };
  }
  return {
    apuredQuantity,
    remainingQuantity: microsToQuantity(remaining),
    rateBp: Math.min(rateBp, 9_999),
    state: apured === 0n ? "open" : "partial",
  };
}

export interface DeclarationApurementProgress {
  readonly state: ApurementDeclarationState;
  readonly lineCount: number;
  readonly apuredLineCount: number;
  readonly partialLineCount: number;
  readonly averageRateBp: number;
  /** Renseigné uniquement lorsque toutes les lignes partagent la même unité. */
  readonly unitCode: string | null;
  readonly apuredQuantity: string | null;
  readonly remainingQuantity: string | null;
}

export function declarationApurementProgress(
  lines: readonly {
    readonly quantity: string;
    readonly apuredQuantity: string;
    readonly unitCode: string;
  }[],
  requiresApurement: boolean,
): DeclarationApurementProgress {
  let apuredMicros = 0n;
  let remainingMicros = 0n;
  let rateSum = 0;
  let apuredLineCount = 0;
  let partialLineCount = 0;
  const units = new Set<string>();
  for (const line of lines) {
    const progress = lineApurementProgress(line.quantity, line.apuredQuantity);
    apuredMicros += quantityToMicros(progress.apuredQuantity);
    remainingMicros += quantityToMicros(progress.remainingQuantity);
    rateSum += progress.rateBp;
    units.add(line.unitCode);
    if (progress.state === "apured") {
      apuredLineCount += 1;
    } else if (progress.state === "partial") {
      partialLineCount += 1;
    }
  }
  const lineCount = lines.length;
  const averageRateBp = lineCount === 0 ? 0 : Math.round(rateSum / lineCount);
  let state: ApurementDeclarationState;
  if (!requiresApurement) {
    state = "not_required";
  } else if (lineCount > 0 && apuredLineCount === lineCount) {
    state = "apured";
  } else if (apuredMicros === 0n) {
    state = "open";
  } else {
    state = "partial";
  }
  const singleUnit = units.size === 1 ? [...units][0]! : null;
  const canTotal = lineCount > 0 && singleUnit !== null;
  return {
    state,
    lineCount,
    apuredLineCount,
    partialLineCount,
    averageRateBp,
    unitCode: singleUnit,
    apuredQuantity: canTotal ? microsToQuantity(apuredMicros) : null,
    remainingQuantity: canTotal ? microsToQuantity(remainingMicros) : null,
  };
}

export function apurementContextError(input: {
  readonly requiresApurement: boolean;
  readonly status: CustomsDeclarationStatus;
  readonly lineQuantity: string;
  readonly apuredQuantity: string;
  readonly requestedQuantity: string;
  readonly unitCode: string;
}): string | null {
  if (!input.requiresApurement) {
    return "Apurement refusé : le régime de cette déclaration ne prévoit pas d'apurement progressif (IM9 / zone franche).";
  }
  if (input.status !== "liquidated" && input.status !== "cleared") {
    return "Apurement refusé : la déclaration doit être liquidée, donc admise sous régime, avant tout apurement.";
  }
  const declared = quantityToMicros(input.lineQuantity);
  const apured = quantityToMicros(input.apuredQuantity);
  const requested = quantityToMicros(input.requestedQuantity);
  if (requested <= 0n) {
    return "Apurement refusé : la quantité doit être strictement positive.";
  }
  if (apured + requested > declared) {
    const remaining = declared - apured;
    return `Apurement refusé : la quantité demandée dépasse le restant de la ligne (restant ${microsToQuantity(remaining > 0n ? remaining : 0n)} ${input.unitCode}).`;
  }
  return null;
}

export const APUREMENT_LINE_STATE_LABELS: Record<ApurementLineState, string> = {
  open: "Ouverte",
  partial: "Partielle",
  apured: "Apurée",
};

export const APUREMENT_DECLARATION_STATE_LABELS: Record<ApurementDeclarationState, string> = {
  not_required: "Non requis",
  open: "Ouvert",
  partial: "Partiel",
  apured: "Apuré",
};
