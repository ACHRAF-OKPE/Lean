export interface PurchaseFormState {
  readonly errors: readonly string[];
}

export const EMPTY_PURCHASE_FORM_STATE: PurchaseFormState = { errors: [] };
