export const REPORT_KINDS = ["resultat", "creances", "engagements"] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  resultat: "Compte de résultat",
  creances: "Balance âgée des créances",
  engagements: "Engagements fournisseurs",
};

export const REPORT_SHEET_NAMES: Record<ReportKind, string> = {
  resultat: "Compte de résultat",
  creances: "Créances clients",
  engagements: "Engagements",
};

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

export const AGING_BUCKETS = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  not_due: "Non échu",
  d1_30: "1 à 30 jours",
  d31_60: "31 à 60 jours",
  d61_90: "61 à 90 jours",
  d90_plus: "Plus de 90 jours",
};

export const INCOME_STATEMENT_SECTIONS = [
  { accountClass: 6, label: "Charges d'exploitation" },
  { accountClass: 7, label: "Produits d'exploitation" },
  { accountClass: 8, label: "Hors activité ordinaire" },
] as const;

export const RESULT_BENEFIT_PREFIX = "131";
export const RESULT_LOSS_PREFIX = "139";
