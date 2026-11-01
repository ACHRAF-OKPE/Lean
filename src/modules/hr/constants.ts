import type {
  HrCalendarDay,
  HrContractKind,
  HrContractStatus,
  HrDayPeriod,
  HrEmployeeStatus,
  HrHolidayKind,
  HrTimeEntryKind,
  HrTimeEntryPeriod,
  HrTimeEntryStatus,
} from "@/db/schema";

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

/* ------------------------------------------------------------- temps de travail */

export const HR_WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const HR_WEEK_DAY_LABELS: Record<HrCalendarDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

export const HR_DAY_PERIODS = ["full", "morning", "afternoon"] as const;

export const HR_DAY_PERIOD_LABELS: Record<HrDayPeriod, string> = {
  full: "Journée",
  morning: "Matin",
  afternoon: "Après-midi",
};

export const HR_HOLIDAY_KINDS = ["public_holiday", "unworked"] as const;

export const HR_HOLIDAY_KIND_LABELS: Record<HrHolidayKind, string> = {
  public_holiday: "Férié",
  unworked: "Chômé",
};

export const HR_TIME_ENTRY_KINDS = ["worked", "absence"] as const;

export const HR_TIME_ENTRY_KIND_LABELS: Record<HrTimeEntryKind, string> = {
  worked: "Travaillé",
  absence: "Absence",
};

export const HR_TIME_ENTRY_PERIODS = ["full", "morning", "afternoon", "hours"] as const;

export const HR_TIME_ENTRY_PERIOD_LABELS: Record<HrTimeEntryPeriod, string> = {
  full: "Journée",
  morning: "Matin",
  afternoon: "Après-midi",
  hours: "Heures",
};

export const HR_TIME_ENTRY_STATUSES = ["draft", "validated"] as const;

export const HR_TIME_ENTRY_STATUS_LABELS: Record<HrTimeEntryStatus, string> = {
  draft: "Brouillon",
  validated: "Validé",
};

export const MAX_CALENDAR_NAME_LENGTH = 80;
export const MAX_HOLIDAY_LABEL_LENGTH = 80;
export const MAX_TIME_ENTRY_NOTE_LENGTH = 120;
export const MIN_ENTRY_HOURS = 0.25;
export const MAX_ENTRY_HOURS = 24;
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isHrCalendarDay(value: string): value is HrCalendarDay {
  return (HR_WEEK_DAYS as readonly string[]).includes(value);
}

export function isHrDayPeriod(value: string): value is HrDayPeriod {
  return (HR_DAY_PERIODS as readonly string[]).includes(value);
}

export function isHrHolidayKind(value: string): value is HrHolidayKind {
  return (HR_HOLIDAY_KINDS as readonly string[]).includes(value);
}

export function isHrTimeEntryKind(value: string): value is HrTimeEntryKind {
  return (HR_TIME_ENTRY_KINDS as readonly string[]).includes(value);
}

export function isHrTimeEntryPeriod(value: string): value is HrTimeEntryPeriod {
  return (HR_TIME_ENTRY_PERIODS as readonly string[]).includes(value);
}

export function isHrTimeEntryStatus(value: string): value is HrTimeEntryStatus {
  return (HR_TIME_ENTRY_STATUSES as readonly string[]).includes(value);
}
