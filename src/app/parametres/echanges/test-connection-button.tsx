"use client";

import { useActionState } from "react";
import { LoaderCircle, PlugZap } from "lucide-react";
import { testEmailAccountAction } from "@/lib/exchange/actions";
import { EMPTY_EXCHANGE_FORM_STATE } from "@/lib/exchange/form-state";

export function TestConnectionButton({ disabled }: { disabled: boolean }) {
  const [, formAction, pending] = useActionState(testEmailAccountAction, EMPTY_EXCHANGE_FORM_STATE);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={disabled || pending}
        aria-label="Tester la connexion SMTP"
        title="Tester la connexion SMTP"
        className="inline-flex items-center gap-2 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] font-medium text-brand-strong transition-colors hover:border-brand/40 disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <PlugZap className="size-3.5" aria-hidden="true" />
        )}
        Tester
      </button>
      <p className="mt-2 text-[10px] leading-4 text-muted">
        Vérifie l&apos;authentification sans envoyer de message ni journaliser de secret.
      </p>
    </form>
  );
}
