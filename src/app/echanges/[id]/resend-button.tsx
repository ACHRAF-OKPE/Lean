"use client";

import { useActionState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { resendExchangeMessageAction } from "@/lib/exchange/actions";
import { EMPTY_EXCHANGE_FORM_STATE } from "@/lib/exchange/form-state";

export function ResendButton({ messageId }: { messageId: string }) {
  const [state, formAction, pending] = useActionState(
    resendExchangeMessageAction,
    EMPTY_EXCHANGE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="messageId" value={messageId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Renvoyer ce message"
        title="Renvoyer ce message"
        className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40 disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="size-4" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <div className="max-w-80">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </form>
  );
}
