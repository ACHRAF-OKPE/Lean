"use client";

import { useState } from "react";
import { ReferenceField, type ReferenceCreateResult } from "@/components/reference-field";
import { createCategoryAction } from "@/lib/catalog/actions";
import type { ReferenceOption } from "@/lib/references";

/** ART-008 + GEN-015 — un tiers porte plusieurs catégories ; une catégorie absente se crée en un clic. */
export function PartnerCategoryPicker({
  options,
  selected,
  canCreate,
}: {
  options: readonly ReferenceOption[];
  selected: readonly string[];
  canCreate: boolean;
}) {
  const [checked, setChecked] = useState<readonly string[]>(selected);
  const [created, setCreated] = useState<readonly ReferenceOption[]>([]);
  const all = [...options, ...created];

  async function createCategory(title: string): Promise<ReferenceCreateResult> {
    const result = await createCategoryAction(title);
    if (result.ok && result.option) {
      const option = result.option;
      setCreated((current) => [...current, option]);
      setChecked((current) => [...current, option.id]);
    }
    return result;
  }

  return (
    <fieldset className="space-y-3">
      <legend className="block text-[11px] font-medium">Catégories</legend>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-1 py-2">
        {all.length === 0 ? (
          <p className="text-[10px] text-muted">
            Aucune catégorie dans cet espace : créez la première ci-dessous.
          </p>
        ) : null}
        {all.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              name="categorie"
              value={option.id}
              checked={checked.includes(option.id)}
              onChange={(event) =>
                setChecked((current) =>
                  event.target.checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id),
                )
              }
              className="size-3.5 accent-brand"
            />
            {option.label}
          </label>
        ))}
      </div>

      {canCreate ? (
        <ReferenceField
          label="Nouvelle catégorie"
          name="categorie_libre"
          options={all}
          canCreate
          onCreate={createCategory}
          createNoun="Catégorie"
          hint="Une valeur absente de la liste se crée en un clic, puis se rattache à la fiche."
        />
      ) : (
        <p className="text-[10px] leading-4 text-muted">
          Seules les catégories existantes sont proposées : leur création relève du paramétrage du
          module.
        </p>
      )}
    </fieldset>
  );
}
