"use client";

import { useId, useState, useTransition } from "react";
import { LoaderCircle, Plus, SearchX, TriangleAlert } from "lucide-react";
import { Field, INPUT_CLASS } from "@/components/form-fields";
import { createHsCodeOptionAction } from "@/lib/catalog/actions";
import {
  hsCodeSuggestionText,
  resolveHsRef,
  suggestHsCodes,
  wordingTwins,
  type HsCodeOption,
} from "@/modules/catalog/hs-codes";

function tecLabel(option: HsCodeOption): string {
  return option.tecRate === null ? "TEC manquant" : `TEC ${option.tecRate} %`;
}

/**
 * ART-017 / ART-018 — champ guidé du code SH : la saisie cherche par code et par libellé (« café »),
 * un code inconnu se crée en un clic (sa chaîne de parents et l'héritage du parent suivent), et un
 * libellé proche déjà présent est signalé avant de créer.
 */
export function HsCodeField({
  label,
  name,
  options,
  canCreate,
  defaultValue = "",
  hint,
  placeholder,
  required,
  id,
  wordingFromId,
}: {
  label: string;
  name: string;
  options: readonly HsCodeOption[];
  canCreate: boolean;
  defaultValue?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  id?: string;
  wordingFromId?: string;
}) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [query, setQuery] = useState(defaultValue);
  const [created, setCreated] = useState<readonly HsCodeOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allOptions = [...options, ...created];
  const state = resolveHsRef(query, allOptions, canCreate);
  const listId = `${fieldId}-liste`;

  const suggestions =
    state.kind === "match" || query.trim() === "" ? [] : suggestHsCodes(query, allOptions, 6);
  const twins =
    state.kind === "create" && !/^\d+$/.test(query.trim())
      ? wordingTwins(query, allOptions).slice(0, 3)
      : [];

  const resolvedCode =
    state.kind === "match" ? state.option.code : state.kind === "empty" ? "" : state.code;

  function createNow() {
    if (state.kind !== "create") {
      return;
    }
    const code = state.code;
    const source = wordingFromId
      ? (document.getElementById(wordingFromId) as HTMLInputElement | HTMLTextAreaElement | null)
      : null;
    const wording = source?.value.trim() ?? "";

    startTransition(async () => {
      const result = await createHsCodeOptionAction({ code, wording: wording || undefined });
      if (result.ok && result.option) {
        const option = result.option;
        setCreated((current) => [...current, option]);
        setQuery(option.code);
        setMessage(
          result.created && result.created.length > 0
            ? `Code ${option.code} créé, parents ${result.created.join(", ")} ajoutés.`
            : null,
        );
        return;
      }
      setMessage(result.error ?? `Le code ${code} n'a pas pu être créé.`);
    });
  }

  return (
    <Field label={label} htmlFor={fieldId} hint={hint}>
      <div className="flex items-end gap-2">
        <input
          id={fieldId}
          value={query}
          list={listId}
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage(null);
          }}
          className={`${INPUT_CLASS} font-mono`}
        />
        <input type="hidden" name={name} value={resolvedCode} />
        <datalist id={listId}>
          {allOptions.slice(0, 200).map((option) => (
            <option key={option.id} value={option.code}>
              {hsCodeSuggestionText(option)}
            </option>
          ))}
        </datalist>

        {state.kind === "create" ? (
          <button
            type="button"
            onClick={createNow}
            disabled={pending}
            aria-label={`Créer le code SH « ${state.code} »`}
            title={`Créer le code SH « ${state.code} » et ses parents`}
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
            title={`« ${state.code} » n'existe pas et la création demande le niveau requis`}
          >
            <SearchX className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {state.kind === "match" ? (
        <p className="mt-1 text-[10px] leading-4 text-brand-strong">
          {hsCodeSuggestionText(state.option)} · {tecLabel(state.option)}
        </p>
      ) : null}

      {state.kind === "create" ? (
        <p className="mt-1 text-[10px] leading-4 text-muted">
          Code {state.code} introuvable : créez-le en un clic. Le parent, l&apos;unité
          complémentaire et le taux TEC vides seront repris du parent le plus proche.
        </p>
      ) : null}

      {twins.length > 0 ? (
        <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-4 text-copper">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            Libellé proche déjà présent :{" "}
            {twins.map((twin) => hsCodeSuggestionText(twin)).join(" ; ")}. Vérifiez qu&apos;il ne
            s&apos;agit pas du même article.
          </span>
        </p>
      ) : null}

      {state.kind === "refused" ? (
        <p className="mt-1 text-[10px] leading-4 text-copper">
          « {state.code} » n&apos;existe pas dans la nomenclature et votre niveau ne permet pas de
          le créer.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul aria-label="Codes SH proposés" className="mt-1 space-y-0.5">
          {suggestions.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery(option.code);
                  setMessage(null);
                }}
                className="text-left font-mono text-[10px] text-muted transition-colors hover:text-brand"
              >
                {hsCodeSuggestionText(option)} · {tecLabel(option)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p role="status" className="mt-1 text-[10px] leading-4 text-brand-strong">
          {message}
        </p>
      ) : null}
    </Field>
  );
}
