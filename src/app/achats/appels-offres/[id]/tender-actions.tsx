"use client";

import { useActionState } from "react";
import { Ban, LoaderCircle, Send, ShoppingCart, Trash2 } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import {
  cancelTenderAction,
  deleteTenderAction,
  generateTenderOrdersAction,
  sendTenderAction,
} from "@/lib/tenders/actions";
import { EMPTY_TENDER_FORM_STATE } from "@/lib/tenders/form-state";

const ICON_BUTTON =
  "grid size-9 place-items-center rounded-md border transition-colors disabled:opacity-50";

function Errors({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 max-w-72">
      <FormErrors errors={errors} />
    </div>
  );
}

export function SendTenderButton({ tenderId }: { tenderId: string }) {
  const [state, formAction, pending] = useActionState(sendTenderAction, EMPTY_TENDER_FORM_STATE);
  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="tenderId" value={tenderId} />
        <button
          type="submit"
          disabled={pending}
          aria-label="Envoyer la demande aux fournisseurs"
          title="Envoyer la demande"
          className={`${ICON_BUTTON} border-transparent bg-brand text-white hover:opacity-90`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      <Errors errors={state.errors} />
    </div>
  );
}

export function DeleteTenderButton({ tenderId }: { tenderId: string }) {
  const [state, formAction, pending] = useActionState(deleteTenderAction, EMPTY_TENDER_FORM_STATE);
  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="tenderId" value={tenderId} />
        <button
          type="submit"
          disabled={pending}
          aria-label="Supprimer le brouillon"
          title="Supprimer le brouillon"
          className={`${ICON_BUTTON} border-copper/20 bg-panel text-copper hover:border-copper/40 hover:bg-copper-soft`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      <Errors errors={state.errors} />
    </div>
  );
}

export function GenerateOrdersButton({ tenderId }: { tenderId: string }) {
  const [state, formAction, pending] = useActionState(
    generateTenderOrdersAction,
    EMPTY_TENDER_FORM_STATE,
  );
  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="tenderId" value={tenderId} />
        <button
          type="submit"
          disabled={pending}
          aria-label="Générer les commandes des lignes attribuées"
          title="Générer les commandes"
          className={`${ICON_BUTTON} border-transparent bg-brand text-white hover:opacity-90`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShoppingCart className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
      <Errors errors={state.errors} />
    </div>
  );
}

export function CancelTenderForm({ tenderId }: { tenderId: string }) {
  const [state, formAction, pending] = useActionState(cancelTenderAction, EMPTY_TENDER_FORM_STATE);
  return (
    <details className="rounded-lg border border-line bg-panel px-4 py-3">
      <summary className="cursor-pointer text-[11px] font-medium text-copper">
        Annuler la demande
      </summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="tenderId" value={tenderId} />
        <label htmlFor="cancel-reason" className="block text-[11px] font-medium">
          Motif d&apos;annulation
        </label>
        <input
          id="cancel-reason"
          name="reason"
          required
          maxLength={500}
          placeholder="Besoin reporté, fournisseurs indisponibles…"
          className={INPUT_CLASS}
        />
        <p className="text-[10px] leading-4 text-muted">
          Les liens publics sont révoqués immédiatement. La demande reste consultable dans
          l&apos;historique.
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-label="Confirmer l'annulation de la demande"
          title="Confirmer l'annulation"
          className={`${ICON_BUTTON} border-copper/20 bg-panel text-copper hover:border-copper/40 hover:bg-copper-soft`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Ban className="size-4" aria-hidden="true" />
          )}
        </button>
        <Errors errors={state.errors} />
      </form>
    </details>
  );
}
