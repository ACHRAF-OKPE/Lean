"use client";

import { useActionState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { saveTaskSettingsAction } from "@/lib/tasks/actions";
import { EMPTY_TASKS_FORM_STATE } from "@/lib/tasks/form-state";
import type { MentionableMember } from "@/modules/discussion/queries";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from "@/modules/tasks/constants";
import { ROLE_LABELS } from "@/modules/identity/labels";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";

export function TaskSettingsForm({
  values,
  members,
}: {
  values: {
    readonly defaultPriority: (typeof TASK_PRIORITIES)[number];
    readonly defaultDueInDays: number;
    readonly defaultAssigneeUserId: string | null;
  };
  members: readonly MentionableMember[];
}) {
  const [state, formAction, pending] = useActionState(
    saveTaskSettingsAction,
    EMPTY_TASKS_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage des tâches</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Priorité par défaut" htmlFor="settings-task-priority">
            <select
              id="settings-task-priority"
              name="defaultPriority"
              defaultValue={values.defaultPriority}
              className={INPUT_CLASS}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Délai d'échéance par défaut"
            htmlFor="settings-task-due-days"
            hint="Jours ajoutés à la date du jour, de 0 à 365. Zéro : aucune échéance proposée."
          >
            <input
              id="settings-task-due-days"
              name="defaultDueInDays"
              type="number"
              min={0}
              max={365}
              step={1}
              inputMode="numeric"
              required
              defaultValue={values.defaultDueInDays}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field
            label="Assigné par défaut"
            htmlFor="settings-task-assignee"
            hint="Facultatif. Seuls les membres de cet espace sont proposés."
          >
            <select
              id="settings-task-assignee"
              name="defaultAssigneeUserId"
              defaultValue={values.defaultAssigneeUserId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Non assignée</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} · {ROLE_LABELS[member.role]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="submit"
          aria-label="Enregistrer le paramétrage des tâches"
          title="Enregistrer le paramétrage des tâches"
          className={SUBMIT}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
        </button>
      </fieldset>
    </form>
  );
}
