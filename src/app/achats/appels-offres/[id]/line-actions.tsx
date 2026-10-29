"use client";

import { useActionState } from "react";
import { Check, LoaderCircle, Send, XCircle } from "lucide-react";
import { INPUT_CLASS } from "@/components/form-fields";
import {
  awardTenderLineAction,
  rejectTenderLineAction,
  resendInvitationAction,
} from "@/lib/tenders/actions";
import { EMPTY_TENDER_FORM_STATE } from "@/lib/tenders/form-state";
import { MAX_TENDER_MOTIVE } from "@/modules/tenders/rules";

const ERROR_CLASS =
  "mt-1 max-w-64 rounded-md border border-copper/20 bg-copper-soft px-2 py-1 text-[10px] leading-4 text-copper";

export function AwardTenderForm({
  tenderId,
  quoteLineId,
  isBest,
}: {
  tenderId: string;
  quoteLineId: string;
  isBest: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    awardTenderLineAction,
    EMPTY_TENDER_FORM_STATE,
  );
  return (
    <form action={formAction} className="flex items-start gap-1.5">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="quoteLineId" value={quoteLineId} />
      <input
        name="motive"
        maxLength={MAX_TENDER_MOTIVE}
        placeholder={isBest ? "Motif (facultatif)" : "Motif obligatoire (prix supérieur)"}
        aria-label={isBest ? "Motif d'attribution facultatif" : "Motif d'attribution obligatoire"}
        className={`${INPUT_CLASS} h-8 min-w-40 px-2 py-1 text-[11px]`}
      />
      <button
        type="submit"
        disabled={pending}
        aria-label="Attribuer cette offre à la ligne"
        title="Attribuer cette offre"
        className="grid size-8 shrink-0 place-items-center rounded-md border border-transparent bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.errors.join(" ")}
        </p>
      ) : null}
    </form>
  );
}

export function RejectTenderLineButton({
  tenderId,
  tenderLineId,
}: {
  tenderId: string;
  tenderLineId: string;
}) {
  const [state, formAction, pending] = useActionState(
    rejectTenderLineAction,
    EMPTY_TENDER_FORM_STATE,
  );
  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderLineId" value={tenderLineId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Écarter cette ligne de l'attribution"
        title="Écarter la ligne"
        className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/30 hover:text-copper disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <XCircle className="size-3.5" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.errors.join(" ")}
        </p>
      ) : null}
    </form>
  );
}

export function ResendInvitationButton({
  tenderId,
  invitationId,
}: {
  tenderId: string;
  invitationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendInvitationAction,
    EMPTY_TENDER_FORM_STATE,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Renvoyer un lien de cotation à ce fournisseur"
        title="Renvoyer le lien"
        className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="size-3.5" aria-hidden="true" />
        )}
      </button>
      {state.errors.length > 0 ? (
        <p role="alert" className={ERROR_CLASS}>
          {state.errors.join(" ")}
        </p>
      ) : null}
    </form>
  );
}
