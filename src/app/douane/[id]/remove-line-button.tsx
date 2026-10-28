"use client";

import { useActionState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { removeDeclarationLineAction } from "@/lib/customs/actions";
import { EMPTY_CUSTOMS_FORM_STATE } from "@/lib/customs/form-state";

export function RemoveLineButton({
  declarationId,
  lineId,
  lineNumber,
}: {
  declarationId: string;
  lineId: string;
  lineNumber: number;
}) {
  const [state, formAction, pending] = useActionState(
    removeDeclarationLineAction,
    EMPTY_CUSTOMS_FORM_STATE,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="declarationId" value={declarationId} />
        <input type="hidden" name="lineId" value={lineId} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`Supprimer la ligne ${lineNumber}`}
          title="Supprimer la ligne"
          className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/30 hover:text-copper disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </form>
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
    </div>
  );
}
