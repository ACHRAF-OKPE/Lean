"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireModule } from "@/lib/auth/session";
import { HR_WEEK_DAYS } from "@/modules/hr/constants";
import { HrError } from "@/modules/hr/errors";
import {
  createTimeEntry,
  createPublicHoliday,
  createWorkCalendar,
  deletePublicHoliday,
  deleteTimeEntry,
  deleteWorkCalendar,
  setTimeEntryStatus,
  setWorkCalendarDefault,
  updatePublicHoliday,
  updateTimeEntry,
  updateWorkCalendar,
} from "@/modules/hr/time-queries";
import type { HrFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, name: string): string {
  return text(formData, name).trim();
}

function failure(error: unknown): HrFormState {
  if (error instanceof HrError) {
    return { errors: [error.message] };
  }
  throw error;
}

function invalid(label: string): HrFormState {
  return { errors: [`${label} invalide.`] };
}

/** HR-009 — les sept jours du calendrier, avec leur rang, viennent du formulaire. */
function calendarDays(formData: FormData) {
  const days: Record<string, Record<string, string | number>> = {};
  HR_WEEK_DAYS.forEach((dayOfWeek, index) => {
    days[dayOfWeek] = {
      morningFrom: optionalText(formData, `${dayOfWeek}MorningFrom`),
      morningTo: optionalText(formData, `${dayOfWeek}MorningTo`),
      afternoonFrom: optionalText(formData, `${dayOfWeek}AfternoonFrom`),
      afternoonTo: optionalText(formData, `${dayOfWeek}AfternoonTo`),
      sequence: Number(optionalText(formData, `${dayOfWeek}Sequence`) || index + 1),
    };
  });
  return days;
}

function calendarRaw(formData: FormData) {
  return {
    name: text(formData, "name"),
    isDefault: formData.get("isDefault") !== null,
    days: calendarDays(formData),
  };
}

/* ------------------------------------------------------------------ calendriers */

export async function createWorkCalendarAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  let calendarId: string;
  try {
    const created = await createWorkCalendar(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: calendarRaw(formData),
    });
    calendarId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/temps/calendriers/${calendarId}?cree=1`);
}

export async function updateWorkCalendarAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const calendarId = text(formData, "calendarId");
  if (!UUID_PATTERN.test(calendarId)) {
    return invalid("Calendrier");
  }
  try {
    await updateWorkCalendar(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      calendarId,
      raw: calendarRaw(formData),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/temps/calendriers/${calendarId}?maj=1`);
}

export async function setWorkCalendarDefaultAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const calendarId = text(formData, "calendarId");
  if (!UUID_PATTERN.test(calendarId)) {
    return invalid("Calendrier");
  }
  try {
    await setWorkCalendarDefault(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      calendarId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/temps/calendriers/${calendarId}?maj=1`);
}

export async function deleteWorkCalendarAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const calendarId = text(formData, "calendarId");
  if (!UUID_PATTERN.test(calendarId)) {
    return invalid("Calendrier");
  }
  try {
    await deleteWorkCalendar(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      calendarId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/temps/calendriers?supprime=1");
}

/* -------------------------------------------------------------- jours fériés */

export async function createPublicHolidayAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  try {
    await createPublicHoliday(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        workDate: text(formData, "workDate"),
        kind: text(formData, "kind"),
        period: optionalText(formData, "period"),
        label: text(formData, "label"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/temps/feries?cree=1");
}

export async function updatePublicHolidayAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const holidayId = text(formData, "holidayId");
  if (!UUID_PATTERN.test(holidayId)) {
    return invalid("Jour férié");
  }
  try {
    await updatePublicHoliday(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      holidayId,
      raw: {
        workDate: text(formData, "workDate"),
        kind: text(formData, "kind"),
        period: optionalText(formData, "period"),
        label: text(formData, "label"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/temps/feries?maj=1");
}

export async function deletePublicHolidayAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const holidayId = text(formData, "holidayId");
  if (!UUID_PATTERN.test(holidayId)) {
    return invalid("Jour férié");
  }
  try {
    await deletePublicHoliday(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      holidayId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/temps/feries?supprime=1");
}

/* ------------------------------------------------------------------ pointages */

function entryRaw(formData: FormData, employeeId: string) {
  return {
    employeeId,
    workDate: text(formData, "workDate"),
    kind: text(formData, "kind"),
    period: text(formData, "period"),
    hours: optionalText(formData, "hours"),
    note: text(formData, "note"),
  };
}

export async function createTimeEntryAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const employeeId = text(formData, "employeeId");
  if (!UUID_PATTERN.test(employeeId)) {
    return invalid("Salarié");
  }
  let entryId: string;
  try {
    const created = await createTimeEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: entryRaw(formData, employeeId),
    });
    entryId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/pointages/${entryId}?cree=1`);
}

export async function updateTimeEntryAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "write");
  const entryId = text(formData, "entryId");
  if (!UUID_PATTERN.test(entryId)) {
    return invalid("Pointage");
  }
  try {
    await updateTimeEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entryId,
      raw: entryRaw(formData, text(formData, "employeeId")),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/pointages/${entryId}?maj=1`);
}

/** HR-011 — valider comme repasser au brouillon relèvent de la gestion. */
export async function setTimeEntryStatusAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const entryId = text(formData, "entryId");
  if (!UUID_PATTERN.test(entryId)) {
    return invalid("Pointage");
  }
  const status = text(formData, "status") === "validated" ? "validated" : "draft";
  try {
    await setTimeEntryStatus(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entryId,
      status,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/rh/pointages/${entryId}?maj=1`);
}

export async function deleteTimeEntryAction(
  _state: HrFormState,
  formData: FormData,
): Promise<HrFormState> {
  const session = await requireModule("hr", "manage");
  const entryId = text(formData, "entryId");
  if (!UUID_PATTERN.test(entryId)) {
    return invalid("Pointage");
  }
  try {
    await deleteTimeEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entryId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/rh/pointages?supprime=1");
}
