"use client";

import { useActionState } from "react";
import { LoaderCircle, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import {
  addMemberAction,
  removeMemberAction,
  saveLevelsAction,
  setResponsibleAction,
  setRoleAction,
} from "@/lib/identity/actions";
import { EMPTY_TEAM_FORM_STATE } from "@/lib/identity/form-state";
import type { Level, ModuleKey } from "@/modules/identity/modules";
import { defaultLevel, levelLabel, moduleLabel, MODULE_KEYS } from "@/modules/identity/modules";
import type { Role } from "@/modules/identity/permissions";
import { ROLE_LABELS } from "@/modules/identity/labels";

const SUBMIT_BUTTON =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50";

const ROLES: readonly Role[] = ["owner", "admin", "member"];

function Submit({
  pending,
  label,
  icon: Icon,
}: {
  pending: boolean;
  label: string;
  icon: typeof Save;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className={SUBMIT_BUTTON}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

export function AddMemberForm() {
  const [state, formAction, pending] = useActionState(addMemberAction, EMPTY_TEAM_FORM_STATE);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nom" htmlFor="memberName">
          <input
            id="memberName"
            name="name"
            type="text"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Adresse e-mail" htmlFor="memberEmail">
          <input
            id="memberEmail"
            name="email"
            type="email"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </Field>
        <Field
          label="Mot de passe temporaire"
          htmlFor="memberPassword"
          hint="12 caractères minimum, à transmettre au membre hors système."
        >
          <input
            id="memberPassword"
            name="password"
            type="password"
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Rôle" htmlFor="memberRole">
          <select id="memberRole" name="role" defaultValue="member" className={INPUT_CLASS}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-start gap-3">
        <Submit pending={pending} label="Ajouter le membre" icon={Plus} />
        {state.errors.length > 0 ? (
          <div className="grow">
            <FormErrors errors={state.errors} />
          </div>
        ) : null}
      </div>
    </form>
  );
}

export function MemberRoleForm({ userId, role }: { userId: string; role: Role }) {
  const [state, formAction, pending] = useActionState(setRoleAction, EMPTY_TEAM_FORM_STATE);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="targetUserId" value={userId} />
      <Field label="Rôle" htmlFor={`role-${userId}`}>
        <select id={`role-${userId}`} name="role" defaultValue={role} className={INPUT_CLASS}>
          {ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {ROLE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </Field>
      <Submit pending={pending} label="Enregistrer le rôle" icon={ShieldCheck} />
      {state.errors.length > 0 ? (
        <div className="pb-1">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </form>
  );
}

export function MemberLevelsForm({
  userId,
  name,
  role,
  grants,
}: {
  userId: string;
  name: string;
  role: Role;
  grants: Partial<Record<ModuleKey, Level>>;
}) {
  const [state, formAction, pending] = useActionState(saveLevelsAction, EMPTY_TEAM_FORM_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="targetUserId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_KEYS.map((key) => (
          <Field
            key={key}
            label={moduleLabel(key)}
            htmlFor={`droit-${userId}-${key}`}
            hint={`Défaut du rôle : ${levelLabel(defaultLevel(role, key))}`}
          >
            <select
              id={`droit-${userId}-${key}`}
              name={`droit:${key}`}
              defaultValue={grants[key] ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">{`Défaut — ${levelLabel(defaultLevel(role, key))}`}</option>
              <option value="none">Aucun accès (sceau)</option>
              <option value="read">Lecture</option>
              <option value="write">Écriture</option>
              <option value="manage">Gestion</option>
            </select>
          </Field>
        ))}
      </div>
      <div className="flex items-start gap-3">
        <Submit pending={pending} label={`Enregistrer les droits de ${name}`} icon={Save} />
        <p className="pt-2 text-[10px] leading-4 text-muted">
          Sans concession, le membre garde le défaut de son rôle. « Aucun accès » verrouille le
          module même si le rôle l&apos;ouvre.
        </p>
        {state.errors.length > 0 ? (
          <div className="grow">
            <FormErrors errors={state.errors} />
          </div>
        ) : null}
      </div>
    </form>
  );
}

export function ModuleResponsibleForm({
  moduleKey,
  currentUserId,
  members,
}: {
  moduleKey: ModuleKey;
  currentUserId: string | null;
  members: readonly { userId: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(setResponsibleAction, EMPTY_TEAM_FORM_STATE);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="module" value={moduleKey} />
      <Field label="Responsable" htmlFor={`responsable-${moduleKey}`}>
        <select
          id={`responsable-${moduleKey}`}
          name="responsibleUserId"
          defaultValue={currentUserId ?? ""}
          className={INPUT_CLASS}
        >
          <option value="">Aucun responsable</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      <Submit
        pending={pending}
        label={`Désigner le responsable de ${moduleLabel(moduleKey)}`}
        icon={Save}
      />
      {state.errors.length > 0 ? (
        <div className="pb-1">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </form>
  );
}

export function RemoveMemberForm({ userId, name }: { userId: string; name: string }) {
  const [state, formAction, pending] = useActionState(removeMemberAction, EMPTY_TEAM_FORM_STATE);

  return (
    <div className="flex items-start gap-2">
      <form action={formAction}>
        <input type="hidden" name="targetUserId" value={userId} />
        <Submit pending={pending} label={`Retirer ${name} de l'espace`} icon={Trash2} />
      </form>
      {state.errors.length > 0 ? (
        <div>
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </div>
  );
}
