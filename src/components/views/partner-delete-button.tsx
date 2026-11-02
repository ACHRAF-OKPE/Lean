"use client";

import { useActionState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { deletePartnerAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";

/** GEN-017 — la suppression d'une fiche demande confirmation et rappelle qu'un tiers cité ne part pas. */
export function PartnerDeleteButton({
  partnerId,
  partnerName,
  retour,
}: {
  partnerId: string;
  partnerName: string;
  retour: string;
}) {
  const [state, formAction, pending] = useActionState(
    deletePartnerAction,
    EMPTY_CATALOG_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-2"
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Supprimer définitivement « ${partnerName} » ? Un tiers cité par un document ne part pas.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="retour" value={retour} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Supprimer le tiers"
        title="Supprimer le tiers"
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
