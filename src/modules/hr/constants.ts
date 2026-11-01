import type { HrContractKind, HrContractStatus, HrEmployeeStatus } from "@/db/schema";

export const HR_EMPLOYEE_STATUSES = ["active", "suspended", "left"] as const;

export const HR_EMPLOYEE_STATUS_LABELS: Record<HrEmployeeStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  left: "Sorti",
};

export const HR_CONTRACT_KINDS = ["cdi", "cdd", "temporary", "internship", "mission"] as const;

export const HR_CONTRACT_KIND_LABELS: Record<HrContractKind, string> = {
  cdi: "CDI",
  cdd: "CDD",
  temporary: "Intérim",
  internship: "Stage",
  mission: "Mission",
};

export const HR_CONTRACT_STATUSES = ["draft", "running", "terminated"] as const;

export const HR_CONTRACT_STATUS_LABELS: Record<HrContractStatus, string> = {
  draft: "Brouillon",
  running: "En cours",
  terminated: "Résilié",
};

/** « Échu » n'est pas stocké : il est dérivé de la date de fin à la lecture (HR-004). */
export type HrContractDisplayStatus = HrContractStatus | "expired";

export const HR_CONTRACT_DISPLAY_LABELS: Record<HrContractDisplayStatus, string> = {
  draft: "Brouillon",
  running: "En cours",
  expired: "Échu",
  terminated: "Résilié",
};

export const FIXED_TERM_KINDS: readonly HrContractKind[] = ["cdd", "temporary", "internship"];

export const DEPARTMENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,9}$/;
export const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,15}$/;
export const MAX_DEPARTMENT_NAME_LENGTH = 80;
export const MAX_PERSON_NAME_LENGTH = 60;
export const MAX_POSITION_LENGTH = 80;
export const MAX_TRIAL_DAYS = 365;
export const MAX_WEEKLY_HOURS = "80";
export const HR_LIST_LIMIT = 200;
export const MAX_DEPARTMENT_DEPTH = 8;

export function isHrEmployeeStatus(value: string): value is HrEmployeeStatus {
  return (HR_EMPLOYEE_STATUSES as readonly string[]).includes(value);
}

export function isHrContractKind(value: string): value is HrContractKind {
  return (HR_CONTRACT_KINDS as readonly string[]).includes(value);
}

export function isHrContractStatus(value: string): value is HrContractStatus {
  return (HR_CONTRACT_STATUSES as readonly string[]).includes(value);
}

export function isFixedTerm(kind: HrContractKind): boolean {
  return FIXED_TERM_KINDS.includes(kind);
}
