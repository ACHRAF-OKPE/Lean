"use client";

import { useActionState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { applyImportAction } from "@/lib/catalog/actions";
import { EMPTY_CATALOG_FORM_STATE } from "@/lib/catalog/form-state";

export function ApplyImportForm({ batchId, count }: { batchId: string; count: number }) {
  const [state, formAction, pending] = useActionState(applyImportAction, EMPTY_CATALOG_FORM_STATE);

  return (
    <form
      action={formAction}
      className="mt-4 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3"
    >
      <input type="hidden" name="batchId" value={batchId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-brand-strong">
            Prêt à écrire {count} ligne{count > 1 ? "s" : ""}.
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-brand-strong/70">
            Aucune donnée métier n&apos;a encore été écrite. La confirmation applique les lignes
            valides et les lignes avec avertissement, dans une seule transaction.
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-label="Confirmer l'import"
          title="Confirmer l'import"
          className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="mt-2">
        <FormErrors errors={state.errors} />
      </div>
    </form>
  );
}
