import type {
  PayrollComponentKind,
  PayrollComponentMode,
  PayrollPeriodStatus,
  PayrollPayslipStatus,
} from "@/db/schema";

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

/* ------------------------------------------------------------- périodes de paie */

export const PAYROLL_PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  draft: "Brouillon",
  validated: "Validée",
};

/** PAY-005 — les douze mois en toutes lettres, indexés de janvier (1) à décembre (12). */
export const PAYROLL_MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

export const MIN_PAYROLL_YEAR = 2000;
export const MAX_PAYROLL_YEAR = 2100;

/** PAY-005 — le libellé d'une période se compose du mois en toutes lettres et de l'année. */
export function payrollPeriodLabel(year: number, month: number): string {
  const monthLabel = PAYROLL_MONTH_LABELS[month - 1] ?? `Mois ${month}`;
  return `${monthLabel} ${year}`;
}

/* ------------------------------------------------------------- bulletins de paie */

export const PAYROLL_PAYSLIP_STATUS_LABELS: Record<PayrollPayslipStatus, string> = {
  draft: "Brouillon",
  validated: "Validé",
};

/** PAY-006 — un bulletin reste un entier de francs, borné comme le salaire du contrat. */
export const MAX_PAYSLIP_AMOUNT_XOF = 2_000_000_000;
