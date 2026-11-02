import type { HrEmployeeStatus, HrLeaveRequestStatus, HrTimeEntryStatus } from "@/db/schema";
import {
  HR_CONTRACT_DISPLAY_LABELS,
  HR_EMPLOYEE_STATUS_LABELS,
  HR_LEAVE_REQUEST_STATUS_LABELS,
  HR_TIME_ENTRY_STATUS_LABELS,
  type HrContractDisplayStatus,
} from "@/modules/hr/constants";

const BASE =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap";

const EMPLOYEE_CLASS: Record<HrEmployeeStatus, string> = {
  active: "border-brand/20 bg-brand-soft text-brand-strong",
  suspended: "border-copper/20 bg-copper-soft text-copper",
  left: "border-line bg-canvas text-muted",
};

const CONTRACT_CLASS: Record<HrContractDisplayStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  running: "border-brand/20 bg-brand-soft text-brand-strong",
  expired: "border-copper/20 bg-copper-soft text-copper",
  terminated: "border-line bg-canvas text-muted",
};

export function EmployeeStatusBadge({ status }: { status: HrEmployeeStatus }) {
  return (
    <span className={`${BASE} ${EMPLOYEE_CLASS[status]}`}>{HR_EMPLOYEE_STATUS_LABELS[status]}</span>
  );
}

/** HR-004 — « échu » est dérivé de la date de fin : le badge lit l'affichage, pas le statut stocké. */
export function ContractStatusBadge({ status }: { status: HrContractDisplayStatus }) {
  return (
    <span className={`${BASE} ${CONTRACT_CLASS[status]}`}>
      {HR_CONTRACT_DISPLAY_LABELS[status]}
    </span>
  );
}

const ENTRY_CLASS: Record<HrTimeEntryStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  validated: "border-brand/20 bg-brand-soft text-brand-strong",
};

/** HR-011 — un pointage validé ne se corrige qu'après retour au brouillon. */
export function TimeEntryStatusBadge({ status }: { status: HrTimeEntryStatus }) {
  return (
    <span className={`${BASE} ${ENTRY_CLASS[status]}`}>{HR_TIME_ENTRY_STATUS_LABELS[status]}</span>
  );
}

const LEAVE_CLASS: Record<HrLeaveRequestStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  validated: "border-brand/20 bg-brand-soft text-brand-strong",
  refused: "border-copper/20 bg-copper-soft text-copper",
  cancelled: "border-line bg-canvas text-muted",
};

/** HR-016 — un congé validé se déduit du calendrier ; un refus ou une annulation n'y touche pas. */
export function LeaveStatusBadge({ status }: { status: HrLeaveRequestStatus }) {
  return (
    <span className={`${BASE} ${LEAVE_CLASS[status]}`}>
      {HR_LEAVE_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}
