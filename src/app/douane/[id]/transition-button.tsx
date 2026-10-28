"use client";

import { useActionState } from "react";
import { BadgeCheck, Ban, Calculator, LoaderCircle, Send, type LucideIcon } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { transitionDeclarationAction } from "@/lib/customs/actions";
import { EMPTY_CUSTOMS_FORM_STATE } from "@/lib/customs/form-state";
import { DECLARATION_TRANSITIONS, type DeclarationTransition } from "@/modules/customs/lifecycle";

const META: Record<DeclarationTransition, { icon: LucideIcon; className: string }> = {
  deposit: {
    icon: Send,
    className: "border-line bg-panel text-muted hover:border-brand/30 hover:text-brand",
  },
  liquidate: {
    icon: Calculator,
    className: "border-transparent bg-brand text-white hover:opacity-90",
  },
  clear: {
    icon: BadgeCheck,
    className: "border-transparent bg-brand text-white hover:opacity-90",
  },
  cancel: {
    icon: Ban,
    className: "border-copper/20 bg-panel text-copper hover:border-copper/40 hover:bg-copper-soft",
  },
};

export function TransitionButton({
  declarationId,
  transition,
}: {
  declarationId: string;
  transition: DeclarationTransition;
}) {
  const [state, formAction, pending] = useActionState(
    transitionDeclarationAction,
    EMPTY_CUSTOMS_FORM_STATE,
  );
  const meta = META[transition];
  const Icon = meta.icon;
  const label = DECLARATION_TRANSITIONS[transition].label;

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="declarationId" value={declarationId} />
        <input type="hidden" name="transition" value={transition} />
        <button
          type="submit"
          disabled={pending}
          aria-label={label}
          title={label}
          className={`grid size-9 place-items-center rounded-md border transition-colors disabled:opacity-50 ${meta.className}`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.length > 0 ? (
        <div className="mt-2 max-w-64">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </div>
  );
}
