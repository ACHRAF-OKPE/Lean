"use client";

import { useActionState, useState } from "react";
import {
  Check,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { HrCalendarDay, HrDayPeriod } from "@/db/schema";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import type { EmployeeOption } from "@/components/hr-forms";
import {
  createPublicHolidayAction,
  createTimeEntryAction,
  createWorkCalendarAction,
  deletePublicHolidayAction,
  deleteTimeEntryAction,
  deleteWorkCalendarAction,
  setWorkCalendarDefaultAction,
  setTimeEntryStatusAction,
  updatePublicHolidayAction,
  updateTimeEntryAction,
  updateWorkCalendarAction,
} from "@/lib/hr/time-actions";
import { EMPTY_HR_FORM_STATE } from "@/lib/hr/form-state";
import {
  HR_DAY_PERIOD_LABELS,
  HR_HOLIDAY_KIND_LABELS,
  HR_TIME_ENTRY_KIND_LABELS,
  HR_TIME_ENTRY_PERIOD_LABELS,
  HR_WEEK_DAY_LABELS,
  HR_WEEK_DAYS,
  MAX_CALENDAR_NAME_LENGTH,
  MAX_HOLIDAY_LABEL_LENGTH,
  MAX_TIME_ENTRY_NOTE_LENGTH,
} from "@/modules/hr/constants";
import {
  availableHalfDays,
  availableHours,
  formatHalfDays,
  formatHours,
  isAfternoonWorked,
  isMorningWorked,
  isPeriodAvailable,
  weekDayOf,
  type CalendarDayBounds,
} from "@/modules/hr/time";
import type { PunchExpectation } from "@/modules/hr/time-queries";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SMALL =
  "grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors disabled:opacity-50";
const TIME_CELL =
  "w-24 rounded-md border border-line bg-panel px-2 py-1 text-[11px] outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

/* ------------------------------------------------------------------ calendrier */

export interface CalendarDayValues {
  readonly morningFrom: string;
  readonly morningTo: string;
  readonly afternoonFrom: string;
  readonly afternoonTo: string;
  readonly sequence: number;
}

export interface CalendarValues {
  readonly name: string;
  readonly isDefault: boolean;
  readonly days: Readonly<Record<HrCalendarDay, CalendarDayValues>>;
}

function emptyDay(sequence: number): CalendarDayValues {
  return { morningFrom: "", morningTo: "", afternoonFrom: "", afternoonTo: "", sequence };
}

export function defaultCalendarValues(): CalendarValues {
  const days: Record<HrCalendarDay, CalendarDayValues> = {} as Record<
    HrCalendarDay,
    CalendarDayValues
  >;
  HR_WEEK_DAYS.forEach((dayOfWeek, index) => {
    days[dayOfWeek] = emptyDay(index + 1);
  });
  return { name: "", isDefault: false, days };
}

export function WorkCalendarForm({
  mode,
  calendarId,
  calendar,
}: {
  mode: "create" | "edit";
  calendarId?: string;
  calendar?: CalendarValues;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createWorkCalendarAction : updateWorkCalendarAction,
    EMPTY_HR_FORM_STATE,
  );
  const values = calendar ?? defaultCalendarValues();

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && calendarId ? (
        <input type="hidden" name="calendarId" value={calendarId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau calendrier de travail" : "Modifier le calendrier"}
        </legend>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field
            label="Nom"
            htmlFor="calendar-name"
            hint={`Nom du calendrier, ${MAX_CALENDAR_NAME_LENGTH} caractères maximum.`}
          >
            <input
              id="calendar-name"
              name="name"
              required
              maxLength={MAX_CALENDAR_NAME_LENGTH}
              defaultValue={values.name}
              className={INPUT_CLASS}
            />
          </Field>
          <CheckboxField
            name="isDefault"
            label="Calendrier de l'espace"
            hint="Un seul calendrier porte ce rôle : il s'applique aux fiches sans calendrier."
            defaultChecked={values.isDefault}
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[11px]">
            <caption className="sr-only">
              Bornes des demi-journées travaillées, jour par jour
            </caption>
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                <th scope="col" className="px-3 py-2">
                  Jour
                </th>
                <th scope="col" className="px-3 py-2">
                  Matin
                </th>
                <th scope="col" className="px-3 py-2">
                  Après-midi
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Rang
                </th>
              </tr>
            </thead>
            <tbody>
              {HR_WEEK_DAYS.map((dayOfWeek, index) => {
                const day = values.days[dayOfWeek] ?? emptyDay(index + 1);
                return (
                  <tr key={dayOfWeek} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {HR_WEEK_DAY_LABELS[dayOfWeek]}
                    </th>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="time"
                          aria-label={`Début du matin le ${HR_WEEK_DAY_LABELS[dayOfWeek]}`}
                          title="Début du matin"
                          name={`${dayOfWeek}MorningFrom`}
                          defaultValue={day.morningFrom}
                          className={TIME_CELL}
                        />
                        <input
                          type="time"
                          aria-label={`Fin du matin le ${HR_WEEK_DAY_LABELS[dayOfWeek]}`}
                          title="Fin du matin"
                          name={`${dayOfWeek}MorningTo`}
                          defaultValue={day.morningTo}
                          className={TIME_CELL}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="time"
                          aria-label={`Début de l'après-midi le ${HR_WEEK_DAY_LABELS[dayOfWeek]}`}
                          title="Début de l'après-midi"
                          name={`${dayOfWeek}AfternoonFrom`}
                          defaultValue={day.afternoonFrom}
                          className={TIME_CELL}
                        />
                        <input
                          type="time"
                          aria-label={`Fin de l'après-midi le ${HR_WEEK_DAY_LABELS[dayOfWeek]}`}
                          title="Fin de l'après-midi"
                          name={`${dayOfWeek}AfternoonTo`}
                          defaultValue={day.afternoonTo}
                          className={TIME_CELL}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        aria-label={`Rang du ${HR_WEEK_DAY_LABELS[dayOfWeek]} dans la semaine`}
                        title="Rang dans la semaine"
                        name={`${dayOfWeek}Sequence`}
                        min={1}
                        max={7}
                        step={1}
                        defaultValue={day.sequence}
                        className={`${TIME_CELL} w-16 text-right tabular-nums`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] leading-4 text-muted">
          Une demi-journée n&apos;est travaillée que si ses deux bornes sont saisies. Le rang 1
          désigne le premier jour de la semaine.
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label={
              mode === "create" ? "Enregistrer le calendrier" : "Enregistrer les modifications"
            }
            title={
              mode === "create" ? "Enregistrer le calendrier" : "Enregistrer les modifications"
            }
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function SetDefaultCalendarButton({
  calendarId,
  label,
}: {
  calendarId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    setWorkCalendarDefaultAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="calendarId" value={calendarId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Désigner « ${label} » comme calendrier de l'espace`}
        title="Calendrier de l'espace (gestion requise)"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Star className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function DeleteWorkCalendarButton({
  calendarId,
  label,
}: {
  calendarId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteWorkCalendarAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="calendarId" value={calendarId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le calendrier ${label}`}
        title="Supprimer le calendrier"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------- jours fériés */

export interface HolidayValues {
  readonly workDate: string;
  readonly kind: string;
  readonly period: string;
  readonly label: string;
}

export function PublicHolidayForm({
  mode,
  holidayId,
  holiday,
  today,
}: {
  mode: "create" | "edit";
  holidayId?: string;
  holiday?: HolidayValues;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createPublicHolidayAction : updatePublicHolidayAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && holidayId ? (
        <input type="hidden" name="holidayId" value={holidayId} />
      ) : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau jour férié ou chômé" : "Modifier le jour férié ou chômé"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Date" htmlFor="holiday-date" hint="AAAA-MM-JJ, une ou deux demi-journées.">
            <input
              id="holiday-date"
              name="workDate"
              type="date"
              required
              defaultValue={holiday?.workDate ?? today}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Libellé" htmlFor="holiday-label" hint="Ex. Fête du travail.">
            <input
              id="holiday-label"
              name="label"
              required
              maxLength={MAX_HOLIDAY_LABEL_LENGTH}
              defaultValue={holiday?.label ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Nature" htmlFor="holiday-kind" hint="Férié ou chômé.">
            <select
              id="holiday-kind"
              name="kind"
              defaultValue={holiday?.kind ?? "public_holiday"}
              className={INPUT_CLASS}
            >
              {Object.entries(HR_HOLIDAY_KIND_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Période"
            htmlFor="holiday-period"
            hint="La journée ou seulement une demi-journée."
          >
            <select
              id="holiday-period"
              name="period"
              defaultValue={holiday?.period ?? "full"}
              className={INPUT_CLASS}
            >
              {Object.entries(HR_DAY_PERIOD_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label={
              mode === "create" ? "Enregistrer le jour férié" : "Enregistrer les modifications"
            }
            title={
              mode === "create" ? "Enregistrer le jour férié" : "Enregistrer les modifications"
            }
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function DeletePublicHolidayButton({
  holidayId,
  label,
}: {
  holidayId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    deletePublicHolidayAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="holidayId" value={holidayId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer ${label}`}
        title="Supprimer la saisie"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ pointages */

export interface TimeEntryValues {
  readonly employeeId: string;
  readonly workDate: string;
  readonly kind: string;
  readonly period: string;
  readonly hours: string;
  readonly note: string;
}

const NO_BOUNDS: CalendarDayBounds = {
  morningFrom: null,
  morningTo: null,
  afternoonFrom: null,
  afternoonTo: null,
};

function halfLabel(
  bounds: CalendarDayBounds,
  holidays: readonly HrDayPeriod[],
  half: "morning" | "afternoon",
) {
  const worked = half === "morning" ? isMorningWorked(bounds) : isAfternoonWorked(bounds);
  if (!worked) {
    return "non travaillée";
  }
  if (holidays.includes("full") || holidays.includes(half)) {
    return "retirée par un jour férié ou chômé";
  }
  const from = half === "morning" ? bounds.morningFrom : bounds.afternoonFrom;
  const to = half === "morning" ? bounds.morningTo : bounds.afternoonTo;
  return `attendue de ${from ?? "—"} à ${to ?? "—"}`;
}

export function TimeEntryForm({
  mode,
  entryId,
  employees,
  entry,
  expectation,
  today,
  presetEmployeeId,
  presetDate,
}: {
  mode: "create" | "edit";
  entryId?: string;
  employees: readonly EmployeeOption[];
  entry?: TimeEntryValues;
  expectation: PunchExpectation;
  today: string;
  presetEmployeeId?: string;
  presetDate?: string;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createTimeEntryAction : updateTimeEntryAction,
    EMPTY_HR_FORM_STATE,
  );
  const [employeeId, setEmployeeId] = useState(
    entry?.employeeId ?? presetEmployeeId ?? employees[0]?.id ?? "",
  );
  const [workDate, setWorkDate] = useState(entry?.workDate ?? presetDate ?? today);

  const calendarId = expectation.employeeCalendarIds[employeeId] ?? expectation.defaultCalendarId;
  const calendar = expectation.calendars.find((item) => item.id === calendarId);
  const bounds = calendar?.days.find((day) => day.dayOfWeek === weekDayOf(workDate)) ?? NO_BOUNDS;
  const holidays = expectation.holidaysByDate[workDate] ?? [];
  const halfDays = availableHalfDays(bounds, holidays);
  const hoursCapacity = availableHours(bounds, holidays);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && entryId ? <input type="hidden" name="entryId" value={entryId} /> : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouveau pointage" : "Modifier le pointage"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Salarié" htmlFor="entry-employee" hint="Fiche active de l'espace.">
            <select
              id="entry-employee"
              name="employeeId"
              required
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un salarié
              </option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.code}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Date"
            htmlFor="entry-date"
            hint="Jamais postérieure à aujourd'hui, en heure d'Abidjan."
          >
            <input
              id="entry-date"
              name="workDate"
              type="date"
              required
              max={today}
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-brand-soft/40 px-3 py-2 text-[10px] leading-4 text-brand-strong">
          <p className="font-medium">
            {HR_WEEK_DAY_LABELS[weekDayOf(workDate)]} {workDate} :{" "}
            {calendar
              ? `calendrier « ${calendar.name} »`
              : "aucun calendrier applicable — créez-le en paramétrage"}
          </p>
          <p className="mt-1">
            Matin {halfLabel(bounds, holidays, "morning")} · après-midi{" "}
            {halfLabel(bounds, holidays, "afternoon")}.
          </p>
          <p className="mt-1 tabular-nums">
            Ce jour compte {formatHalfDays(halfDays)} demi-journée(s) et{" "}
            {formatHours(hoursCapacity)} heure(s) de travail attendu(es).
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Nature" htmlFor="entry-kind" hint="Temps travaillé ou absence.">
            <select
              id="entry-kind"
              name="kind"
              defaultValue={entry?.kind ?? "worked"}
              className={INPUT_CLASS}
            >
              {Object.entries(HR_TIME_ENTRY_KIND_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Période"
            htmlFor="entry-period"
            hint="Seules les demi-journées attendues restent ouvertes."
          >
            <select
              id="entry-period"
              name="period"
              defaultValue={entry?.period ?? "full"}
              className={INPUT_CLASS}
            >
              {Object.entries(HR_TIME_ENTRY_PERIOD_LABELS).map(([key, label]) => {
                const available =
                  key === "hours"
                    ? hoursCapacity > 0
                    : isPeriodAvailable(bounds, holidays, key as "full" | "morning" | "afternoon");
                return (
                  <option key={key} value={key} disabled={!available}>
                    {label}
                  </option>
                );
              })}
            </select>
          </Field>

          <Field
            label="Heures"
            htmlFor="entry-hours"
            hint="Uniquement si la période est « Heures », au quart d'heure."
          >
            <input
              id="entry-hours"
              name="hours"
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              defaultValue={entry?.hours ?? ""}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field
          label="Motif"
          htmlFor="entry-note"
          hint={`Obligatoire pour une absence, réservé aux absences, ${MAX_TIME_ENTRY_NOTE_LENGTH} caractères maximum.`}
        >
          <input
            id="entry-note"
            name="note"
            maxLength={MAX_TIME_ENTRY_NOTE_LENGTH}
            defaultValue={entry?.note ?? ""}
            className={INPUT_CLASS}
          />
        </Field>

        <p className="text-[10px] leading-4 text-muted">
          Le pointage naît en brouillon : sa validation, son retour au brouillon et sa suppression
          relèvent de la gestion.
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || !employeeId || !workDate}
            aria-label={
              mode === "create" ? "Enregistrer le pointage" : "Enregistrer les modifications"
            }
            title={mode === "create" ? "Enregistrer le pointage" : "Enregistrer les modifications"}
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={mode === "create" ? Plus : Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function ValidateTimeEntryButton({ entryId, label }: { entryId: string; label: string }) {
  const [state, formAction, pending] = useActionState(
    setTimeEntryStatusAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="status" value="validated" />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Valider le pointage ${label}`}
        title="Valider (gestion requise)"
        className={`${SMALL} hover:border-brand/30 hover:text-brand`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function ReopenTimeEntryButton({ entryId, label }: { entryId: string; label: string }) {
  const [state, formAction, pending] = useActionState(
    setTimeEntryStatusAction,
    EMPTY_HR_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="status" value="draft" />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Repasser au brouillon le pointage ${label}`}
        title="Repasser au brouillon (gestion requise)"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function DeleteTimeEntryButton({ entryId, label }: { entryId: string; label: string }) {
  const [state, formAction, pending] = useActionState(deleteTimeEntryAction, EMPTY_HR_FORM_STATE);

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="entryId" value={entryId} />
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-72">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le pointage ${label}`}
        title="Supprimer le brouillon"
        className={`${SMALL} hover:border-copper/30 hover:text-copper`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
