export interface StockFormState {
  readonly errors: readonly string[];
}

export const EMPTY_STOCK_FORM_STATE: StockFormState = { errors: [] };
