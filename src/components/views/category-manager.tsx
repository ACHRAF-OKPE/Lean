"use client";

import { useActionState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import {
  createCategoryFormAction,
  deleteCategoryAction,
  renameCategoryAction,
  setCategoryActiveAction,
} from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";
import { MAX_CATEGORY_TITLE_LENGTH } from "@/modules/catalog/categories";
import type { PartnerCategory } from "@/modules/catalog/partner-queries";

const ACTION =
  "grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";

function CreateCategory() {
  const [state, formAction, pending] = useActionState(
    createCategoryFormAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  return (
    <form action={formAction} className="rounded-xl border border-line bg-panel p-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="flex items-end gap-2">
        <div className="grow">
          <Field
            label="Nouvelle catégorie"
            htmlFor="titre"
            hint={`${MAX_CATEGORY_TITLE_LENGTH} caractères maximum, libellé unique dans l'espace.`}
          >
            <input
              id="titre"
              name="titre"
              required
              maxLength={MAX_CATEGORY_TITLE_LENGTH}
              placeholder="Revendeurs"
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <button
          type="submit"
          aria-label="Créer la catégorie"
          title="Créer la catégorie"
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
        </button>
      </fieldset>
    </form>
  );
}

function CategoryRow({ category }: { category: PartnerCategory }) {
  const [renameState, renameAction, renaming] = useActionState(
    renameCategoryAction,
    EMPTY_CATALOG_FORM_STATE,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    setCategoryActiveAction,
    EMPTY_CATALOG_FORM_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteCategoryAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  const errors = [...renameState.errors, ...toggleState.errors, ...deleteState.errors];
  const preset = category.active ? "non" : "oui";
  const toggleLabel = category.active ? "Désactiver la catégorie" : "Réactiver la catégorie";
  const carried = category.partnerCount > 0;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameAction} className="flex min-w-64 grow items-center gap-2">
          <input type="hidden" name="categoryId" value={category.id} />
          <input
            name="titre"
            defaultValue={category.title}
            maxLength={MAX_CATEGORY_TITLE_LENGTH}
            aria-label={`Libellé de la catégorie ${category.title}`}
            className={`${INPUT_CLASS} max-w-sm`}
          />
          <span className="font-mono text-[10px] whitespace-nowrap text-muted tabular-nums">
            {category.partnerCount} tiers
          </span>
          <button
            type="submit"
            disabled={renaming}
            aria-label="Renommer la catégorie"
            title="Renommer la catégorie"
            className={ACTION}
          >
            {renaming ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
          </button>
        </form>

        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            category.active
              ? "border-line bg-canvas text-muted"
              : "border-copper/15 bg-copper-soft text-copper"
          }`}
        >
          {category.active ? "Active" : "Désactivée"}
        </span>

        <form action={toggleAction}>
          <input type="hidden" name="categoryId" value={category.id} />
          <input type="hidden" name="actif" value={preset} />
          <button
            type="submit"
            disabled={toggling}
            aria-label={toggleLabel}
            title={toggleLabel}
            className={ACTION}
          >
            {category.active ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="categoryId" value={category.id} />
          <button
            type="submit"
            disabled={deleting || carried}
            aria-label="Supprimer la catégorie"
            title={
              carried
                ? "Suppression impossible : des tiers portent cette catégorie"
                : "Supprimer la catégorie"
            }
            className={`${ACTION} hover:text-copper`}
          >
            {deleting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
          </button>
        </form>
      </div>

      {errors.length > 0 ? (
        <div className="mt-2">
          <FormErrors errors={errors} />
        </div>
      ) : null}
    </li>
  );
}

/** ART-008 — le classement des tiers se paramètre ici : créer, renommer, désactiver, supprimer. */
export function CategoryManager({ categories }: { categories: readonly PartnerCategory[] }) {
  return (
    <div className="mt-5 space-y-4">
      <CreateCategory />

      {categories.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel px-5 py-10 text-center text-[11px] leading-5 text-muted">
          Aucune catégorie. Créez-en une ci-dessus : elle regroupera une colonne de Kanban et un
          filtre du registre.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </div>
  );
}
