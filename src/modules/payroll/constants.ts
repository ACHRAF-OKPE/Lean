import type { PayrollComponentKind, PayrollComponentMode } from "@/db/schema";

export const PAYROLL_COMPONENT_KINDS = ["earning", "deduction"] as const;

export const PAYROLL_COMPONENT_KIND_LABELS: Record<PayrollComponentKind, string> = {
  earning: "Gain",
  deduction: "Retenue",
};

export const PAYROLL_COMPONENT_MODES = ["fixed", "percent"] as const;

export const PAYROLL_COMPONENT_MODE_LABELS: Record<PayrollComponentMode, string> = {
  fixed: "Montant fixe",
  percent: "Pourcentage",
};

/** PAY-003 — le code d'une rubrique reste court, en majuscules, chiffres et tirets bas. */
export const PAYROLL_COMPONENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,15}$/;
export const MAX_PAYROLL_COMPONENT_LABEL_LENGTH = 80;
export const MAX_COMPONENT_AMOUNT_XOF = 2_000_000_000;
export const MAX_CONTRIBUTION_RATE = 100;
export const PAYROLL_RATE_SCALE = 6;

export function isPayrollComponentKind(value: string): value is PayrollComponentKind {
  return (PAYROLL_COMPONENT_KINDS as readonly string[]).includes(value);
}

export function isPayrollComponentMode(value: string): value is PayrollComponentMode {
  return (PAYROLL_COMPONENT_MODES as readonly string[]).includes(value);
}
