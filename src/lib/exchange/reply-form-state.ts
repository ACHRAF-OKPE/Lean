export interface SupplierReplyFormState {
  readonly errors: readonly string[];
  readonly done?: boolean;
}

export const EMPTY_SUPPLIER_REPLY_FORM_STATE: SupplierReplyFormState = { errors: [] };
