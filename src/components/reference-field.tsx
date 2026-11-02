"use client";

import { useId, useState, useTransition } from "react";
import { LoaderCircle, Plus, SearchX } from "lucide-react";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { resolveReference, type ReferenceOption } from "@/lib/references";

export interface ReferenceCreateResult {
  readonly ok: boolean;
  readonly option?: ReferenceOption;
  readonly error?: string;
}

/**
 * GEN-015 — champ de référence à saisie libre : une valeur inconnue est proposée à la création en
 * un clic quand l'utilisateur en a le droit, sinon le refus est écrit sous le champ.
 */
export function ReferenceField({
  label,
  name,
  options,
  canCreate,
  onCreate,
  createNoun,
  hint,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  options: readonly ReferenceOption[];
  canCreate: boolean;
  onCreate: (title: string) => Promise<ReferenceCreateResult>;
  createNoun: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const fallbackId = useId();
  const [query, setQuery] = useState("");
  const [created, setCreated] = useState<readonly ReferenceOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allOptions = [...options, ...created];
  const state = resolveReference(query, allOptions, canCreate);
  const listId = `${fallbackId}-liste`;

  function createNow() {
    if (state.kind !== "create") {
      return;
    }
    const title = state.label;
    startTransition(async () => {
      const result = await onCreate(title);
      if (result.ok && result.option) {
        setCreated((current) => [...current, result.option!]);
        setMessage(null);
        return;
      }
      setMessage(result.error ?? `Le ${createNoun.toLowerCase()} n'a pas pu être créé.`);
    });
  }

  return (
    <Field label={label} htmlFor={fallbackId} hint={hint}>
      <div className="flex items-end gap-2">
        <input
          id={fallbackId}
          name={name}
          value={query}
          list={listId}
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage(null);
          }}
          className={INPUT_CLASS}
        />
        <datalist id={listId}>
          {allOptions.map((option) => (
            <option key={option.id} value={option.label} />
          ))}
        </datalist>

        {state.kind === "create" ? (
          <button
            type="button"
            onClick={createNow}
            disabled={pending}
            aria-label={`Créer ${createNoun.toLowerCase()} « ${state.label} »`}
            title={`Créer ${createNoun.toLowerCase()} « ${state.label} » en un clic`}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}

        {state.kind === "refused" ? (
          <span
            className="grid size-9 shrink-0 place-items-center text-copper"
            title={`« ${state.label} » n'existe pas et la création demande le niveau requis`}
          >
            <SearchX className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {state.kind === "create" ? (
        <p className="mt-1 text-[10px] leading-4 text-muted">
          {createNoun} « {state.label} » introuvable : créez-le en un clic.
        </p>
      ) : null}
      {state.kind === "refused" ? (
        <p className="mt-1 text-[10px] leading-4 text-copper">
          « {state.label} » n&apos;existe pas dans la liste et votre niveau ne permet pas de le
          créer.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-1 text-[10px] leading-4 text-copper">
          {message}
        </p>
      ) : null}
    </Field>
  );
}
