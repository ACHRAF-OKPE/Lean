export interface SettingsFormState {
  readonly errors: readonly string[];
}

export const EMPTY_SETTINGS_FORM_STATE: SettingsFormState = { errors: [] };
