export interface DiscussionFormState {
  readonly errors: readonly string[];
  readonly ok: boolean;
}

export const initialDiscussionFormState: DiscussionFormState = { errors: [], ok: false };
