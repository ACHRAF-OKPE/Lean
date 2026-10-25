export interface CatalogFormState {
  readonly errors: readonly string[];
}

export const EMPTY_CATALOG_FORM_STATE: CatalogFormState = { errors: [] };
