export interface SalesFormState {
  readonly errors: readonly string[];
}

export const EMPTY_SALES_FORM_STATE: SalesFormState = { errors: [] };
