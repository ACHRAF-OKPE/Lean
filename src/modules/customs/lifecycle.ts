import type { CustomsBondStatus, CustomsDeclarationStatus } from "@/db/schema";
import { CUSTOMS_DECLARATION_STATUS_LABELS } from "./constants";

export type DeclarationTransition = "deposit" | "liquidate" | "clear" | "cancel";

export const DECLARATION_TRANSITIONS: Record<
  DeclarationTransition,
  {
    readonly to: CustomsDeclarationStatus;
    readonly from: readonly CustomsDeclarationStatus[];
    readonly label: string;
  }
> = {
  deposit: { to: "deposited", from: ["draft"], label: "Déposer la déclaration" },
  liquidate: { to: "liquidated", from: ["deposited"], label: "Liquider" },
  clear: { to: "cleared", from: ["liquidated"], label: "Donner mainlevée" },
  cancel: {
    to: "cancelled",
    from: ["draft", "deposited", "liquidated"],
    label: "Annuler la déclaration",
  },
};

export function transitionError(
  status: CustomsDeclarationStatus,
  transition: DeclarationTransition,
): string | null {
  const rule = DECLARATION_TRANSITIONS[transition];
  if (rule.from.includes(status)) {
    return null;
  }
  return `Transition refusée : une déclaration ${CUSTOMS_DECLARATION_STATUS_LABELS[status].toLowerCase()} ne peut pas passer à « ${CUSTOMS_DECLARATION_STATUS_LABELS[rule.to].toLowerCase()} ».`;
}

export function cancellationContextError(input: {
  readonly paidTotal: number;
  readonly hasOpenBond: boolean;
  readonly hasApurement: boolean;
}): string | null {
  if (input.paidTotal > 0) {
    return "Annulation refusée : des paiements sont déjà enregistrés sur cette déclaration.";
  }
  if (input.hasOpenBond) {
    return "Annulation refusée : un acquit-à-caution est encore ouvert. Apurez-le d'abord.";
  }
  if (input.hasApurement) {
    return "Annulation refusée : des apurements progressifs sont déjà enregistrés sur cette déclaration.";
  }
  return null;
}

export function clearingContextError(input: {
  readonly paidTotal: number;
  readonly grandTotal: number;
  readonly requiresBond: boolean;
  readonly bondStatus: CustomsBondStatus | null;
}): string | null {
  if (input.paidTotal < input.grandTotal) {
    return "Mainlevée refusée : le montant à payer n'est pas intégralement réglé.";
  }
  if (input.requiresBond && input.bondStatus !== "apured") {
    return "Mainlevée refusée : le régime exige un acquit-à-caution apuré.";
  }
  return null;
}
