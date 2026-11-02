/** GEN-015 — deux libellés identiques à la casse ou aux espaces près désignent la même référence. */
export function normalizeReferenceLabel(value: string): string {
  return value.trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");
}

export interface ReferenceOption {
  readonly id: string;
  readonly label: string;
}

export type ReferenceState =
  | { readonly kind: "empty" }
  | { readonly kind: "match"; readonly option: ReferenceOption }
  | { readonly kind: "create"; readonly label: string }
  | { readonly kind: "refused"; readonly label: string };

/**
 * Ce que le champ de référence sait faire de la saisie courante : reconnaître une valeur existante,
 * proposer de créer celle qui manque, ou dire pourquoi la création est fermée.
 */
export function resolveReference(
  query: string,
  options: readonly ReferenceOption[],
  canCreate: boolean,
): ReferenceState {
  const label = normalizeReferenceLabel(query);
  if (label === "") {
    return { kind: "empty" };
  }

  const existing = options.find((option) => normalizeReferenceLabel(option.label) === label);
  if (existing) {
    return { kind: "match", option: existing };
  }

  const raw = query.trim();
  return canCreate ? { kind: "create", label: raw } : { kind: "refused", label: raw };
}

/** Les suggestions affichées sous le champ : valeurs dont le libellé contient la saisie, en tête de liste. */
export function suggestReferences(
  query: string,
  options: readonly ReferenceOption[],
  limit = 8,
): readonly ReferenceOption[] {
  const label = normalizeReferenceLabel(query);
  if (label === "") {
    return options.slice(0, limit);
  }
  return options
    .filter((option) => normalizeReferenceLabel(option.label).includes(label))
    .slice(0, limit);
}
