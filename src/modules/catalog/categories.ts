/** ART-008 — le libellé d'une catégorie est porté par l'espace : mêmes espaces et même casse, même catégorie. */
export const MAX_CATEGORY_TITLE_LENGTH = 60;

export function normalizeCategoryTitle(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_CATEGORY_TITLE_LENGTH);
}

export function categoryTitleErrors(title: string): string[] {
  const errors: string[] = [];
  if (title === "") {
    errors.push("Le libellé de la catégorie est obligatoire.");
  }
  if (title.length > MAX_CATEGORY_TITLE_LENGTH) {
    errors.push(`Le libellé de la catégorie dépasse ${MAX_CATEGORY_TITLE_LENGTH} caractères.`);
  }
  return errors;
}

export function sameCategoryTitle(a: string, b: string): boolean {
  return a.toLocaleLowerCase("fr") === b.toLocaleLowerCase("fr");
}

/** ART-008 + ART-012 — une catégorie portée ne se supprime pas, elle se désactive. */
export function planCategoryDelete(input: {
  title: string;
  count: number;
  subject: string;
}): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (input.count > 0) {
    return {
      ok: false,
      error: `La catégorie « ${input.title} » porte ${input.count} ${input.subject} : désactivez-la au lieu de la supprimer.`,
    };
  }
  return { ok: true };
}

/** Un tiers garde sa catégorie désactivée ; elle disparaît seulement des propositions. */
export function isCategorySelectable(active: boolean): boolean {
  return active;
}
