"use client";

import { useActionState } from "react";
import { Ban, Check, LoaderCircle, Play, RotateCcw, Save, type LucideIcon } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { assignTaskAction, changeTaskStatusAction } from "@/lib/tasks/actions";
import { EMPTY_TASKS_FORM_STATE } from "@/lib/tasks/form-state";
import type { TaskStatus } from "@/db/schema";
import type { MentionableMember } from "@/modules/discussion/queries";
import { TASK_TRANSITIONS } from "@/modules/tasks/lifecycle";
import { ROLE_LABELS } from "@/modules/identity/labels";

const STATUS_ACTION_META: Record<
  TaskStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  open: {
    label: "Rouvrir la tâche",
    icon: RotateCcw,
    className: "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand",
  },
  in_progress: {
    label: "Démarrer la tâche",
    icon: Play,
    className: "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand",
  },
  done: {
    label: "Terminer la tâche",
    icon: Check,
    className: "border-transparent bg-brand text-white hover:opacity-90",
  },
  cancelled: {
    label: "Annuler la tâche",
    icon: Ban,
    className: "border-copper/20 bg-panel text-copper hover:border-copper/40 hover:bg-copper-soft",
  },
};

function StatusButton({ taskId, target }: { taskId: string; target: TaskStatus }) {
  const [state, formAction, pending] = useActionState(
    changeTaskStatusAction,
    EMPTY_TASKS_FORM_STATE,
  );
  const meta = STATUS_ACTION_META[target];
  const Icon = meta.icon;

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="status" value={target} />
        <button
          type="submit"
          disabled={pending}
          aria-label={meta.label}
          title={meta.label}
          className={`grid size-9 place-items-center rounded-md border transition-colors disabled:opacity-50 ${meta.className}`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </div>
  );
}

export function TaskStatusActions({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const targets = TASK_TRANSITIONS[status];
  return (
    <div className="flex flex-wrap items-start gap-2">
      {targets.map((target) => (
        <StatusButton key={target} taskId={taskId} target={target} />
      ))}
    </div>
  );
}

export function TaskAssigneeForm({
  taskId,
  assigneeUserId,
  members,
}: {
  taskId: string;
  assigneeUserId: string | null;
  members: readonly MentionableMember[];
}) {
  const [state, formAction, pending] = useActionState(assignTaskAction, EMPTY_TASKS_FORM_STATE);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="taskId" value={taskId} />
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="assigneeUserId" className="block text-[11px] font-medium">
            Assigné
          </label>
          <select
            id="assigneeUserId"
            name="assigneeUserId"
            defaultValue={assigneeUserId ?? ""}
            disabled={pending}
            className={INPUT_CLASS}
          >
            <option value="">Non assignée</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name} · {ROLE_LABELS[member.role]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer l'assignation"
          title="Enregistrer l'assignation"
          className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </div>
  );
}
