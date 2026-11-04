export interface PayrollFormState {
  readonly errors: readonly string[];
}

export const EMPTY_PAYROLL_FORM_STATE: PayrollFormState = { errors: [] };
