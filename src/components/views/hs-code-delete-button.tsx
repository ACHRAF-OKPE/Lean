"use client";

import { useActionState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { deleteHsCodeAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";

/** ART-023 — la suppression d'un code SH demande confirmation et rappelle qu'un code cité ne part pas. */
export function HsCodeDeleteButton({ hsCodeId, code }: { hsCodeId: string; code: string }) {
  const [state, formAction, pending] = useActionState(deleteHsCodeAction, EMPTY_CATALOG_FORM_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-2"
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Supprimer définitivement le code ${code} ? Un code cité par un article, une ligne de déclaration ou portant des enfants ne part pas.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="hsCodeId" value={hsCodeId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Supprimer le code SH"
        title="Supprimer le code SH"
        className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/30 hover:text-copper disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <div className="max-w-sm">
          <FormErrors errors={state.errors} />
        </div>
      ) : null}
    </form>
  );
}
