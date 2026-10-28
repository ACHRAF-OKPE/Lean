"use client";

import { useActionState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createTaskAction, updateTaskAction } from "@/lib/tasks/actions";
import { EMPTY_TASKS_FORM_STATE } from "@/lib/tasks/form-state";
import type { MentionableMember } from "@/modules/discussion/queries";
import type { TaskPriority, TaskRelatedEntityType } from "@/db/schema";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RELATED_LABELS,
} from "@/modules/tasks/constants";
import { ROLE_LABELS } from "@/modules/identity/labels";

export interface TaskFormValues {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly dueDate: string | null;
  readonly assigneeUserId: string | null;
}

export interface LinkedDocument {
  readonly type: TaskRelatedEntityType;
  readonly id: string;
  readonly label: string;
}

const RELATED_TYPES = Object.keys(TASK_RELATED_LABELS) as TaskRelatedEntityType[];

export function TaskForm({
  mode,
  members,
  taskId,
  task,
  linkedDocument,
}: {
  mode: "create" | "edit";
  members: readonly MentionableMember[];
  taskId?: string;
  task?: TaskFormValues;
  linkedDocument?: LinkedDocument;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createTaskAction : updateTaskAction,
    EMPTY_TASKS_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && taskId ? <input type="hidden" name="taskId" value={taskId} /> : null}
      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">
          {mode === "create" ? "Nouvelle tâche" : "Modifier la tâche"}
        </legend>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Titre" htmlFor="title" hint="160 caractères maximum.">
              <input
                id="title"
                name="title"
                required
                maxLength={160}
                defaultValue={task?.title ?? ""}
                className={INPUT_CLASS}
                placeholder="Relancer le règlement de la facture"
              />
            </Field>
          </div>

          <Field label="Priorité" htmlFor="priority" hint="Normale par défaut.">
            <select
              id="priority"
              name="priority"
              defaultValue={task?.priority ?? "normal"}
              className={INPUT_CLASS}
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TASK_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Échéance" htmlFor="dueDate" hint="Facultative, au format AAAA-MM-JJ.">
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              defaultValue={task?.dueDate ?? ""}
              className={INPUT_CLASS}
            />
          </Field>

          {mode === "create" ? (
            <Field
              label="Assigné"
              htmlFor="assigneeUserId"
              hint="Facultatif. Seuls les membres de l'espace apparaissent ici."
            >
              <select
                id="assigneeUserId"
                name="assigneeUserId"
                defaultValue=""
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
          ) : null}

          <div className="md:col-span-2">
            <Field
              label="Description"
              htmlFor="description"
              hint="Facultative, texte brut, 4 000 caractères maximum."
            >
              <textarea
                id="description"
                name="description"
                rows={5}
                maxLength={4000}
                defaultValue={task?.description ?? ""}
                className={INPUT_CLASS}
                placeholder="Contacter le client et confirmer la date de virement."
              />
            </Field>
          </div>
        </div>

        {mode === "create" ? (
          linkedDocument ? (
            <div className="rounded-lg border border-line bg-canvas px-4 py-3">
              <p className="text-[10px] tracking-[0.12em] text-muted uppercase">Document lié</p>
              <p className="mt-1 text-[11px] font-medium">
                {TASK_RELATED_LABELS[linkedDocument.type]} · {linkedDocument.label}
              </p>
              <input type="hidden" name="relatedEntityType" value={linkedDocument.type} />
              <input type="hidden" name="relatedEntityId" value={linkedDocument.id} />
            </div>
          ) : (
            <fieldset className="rounded-lg border border-line bg-canvas px-4 py-3">
              <legend className="px-1 text-[10px] tracking-[0.12em] text-muted uppercase">
                Document lié (facultatif)
              </legend>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Type" htmlFor="relatedEntityType">
                  <select
                    id="relatedEntityType"
                    name="relatedEntityType"
                    defaultValue=""
                    className={INPUT_CLASS}
                  >
                    <option value="">Aucun</option>
                    {RELATED_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TASK_RELATED_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Référence"
                  htmlFor="documentReference"
                  hint="Code du tiers ou numéro du document existant."
                >
                  <input
                    id="documentReference"
                    name="documentReference"
                    className={INPUT_CLASS}
                    placeholder="CLI001 ou FAC-2026-014"
                  />
                </Field>
              </div>
            </fieldset>
          )
        ) : null}

        <button
          type="submit"
          aria-label={mode === "create" ? "Créer la tâche" : "Enregistrer les modifications"}
          title={mode === "create" ? "Créer la tâche" : "Enregistrer les modifications"}
          className="grid size-9 place-items-center rounded-md border border-transparent bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
        </button>
      </fieldset>
    </form>
  );
}
