export interface TasksFormState {
  readonly errors: readonly string[];
}

export const EMPTY_TASKS_FORM_STATE: TasksFormState = { errors: [] };
