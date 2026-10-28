"use client";

import { useActionState } from "react";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { EMPTY_SUPPLIER_REPLY_FORM_STATE } from "@/lib/exchange/reply-form-state";
import { submitSupplierReplyAction } from "./actions";

const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-32 resize-y text-[12px] leading-5`;

const AVAILABILITY_CHOICES = [
  {
    value: "available",
    label: "Disponible",
    hint: "La commande peut être livrée telle quelle.",
  },
  {
    value: "partial",
    label: "Partiellement disponible",
    hint: "Une partie seulement peut être livrée : précisez le motif.",
  },
  {
    value: "unavailable",
    label: "Indisponible",
    hint: "Aucune quantité ne peut être livrée : précisez le motif.",
  },
] as const;

export function SupplierReplyForm({
  token,
  defaultName,
  defaultEmail,
  maxComment,
  maxAttachmentBytes,
}: {
  token: string;
  defaultName: string;
  defaultEmail: string;
  maxComment: number;
  maxAttachmentBytes: number;
}) {
  const [state, formAction, pending] = useActionState(
    submitSupplierReplyAction,
    EMPTY_SUPPLIER_REPLY_FORM_STATE,
  );

  if (state.done) {
    return (
      <section
        role="status"
        className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft px-6 py-10 text-center"
      >
        <CheckCircle2 className="size-6 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-brand-strong">Réponse transmise</h2>
        <p className="max-w-md text-[11px] leading-5 text-brand-strong">
          Votre réponse a été enregistrée et l&apos;acheteur en est informé. Vous pouvez fermer
          cette page ; le lien reste actif pour une correction.
        </p>
      </section>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-5 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="token" value={token} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Site web</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <h2 className="text-sm font-semibold">Votre réponse</h2>
        <p className="mt-0.5 text-[10px] leading-4 text-muted">
          Aucun compte n&apos;est nécessaire. Les champs marqués d&apos;un astérisque sont
          obligatoires.
        </p>
      </div>

      <FormErrors errors={state.errors} />

      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Réponse du fournisseur</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Votre nom *" htmlFor="authorName">
            <input
              id="authorName"
              name="authorName"
              type="text"
              required
              maxLength={120}
              defaultValue={defaultName}
              autoComplete="name"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Votre e-mail"
            htmlFor="authorEmail"
            hint="Facultatif, pour être recontacté."
          >
            <input
              id="authorEmail"
              name="authorEmail"
              type="email"
              maxLength={160}
              defaultValue={defaultEmail}
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[11px] font-medium">Disponibilité *</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {AVAILABILITY_CHOICES.map((choice, index) => (
              <label
                key={choice.value}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-line bg-panel px-3 py-2"
              >
                <input
                  type="radio"
                  name="availability"
                  value={choice.value}
                  defaultChecked={index === 0}
                  required
                  className="mt-0.5 size-3.5 accent-brand"
                />
                <span>
                  <span className="block text-[11px] font-medium">{choice.label}</span>
                  <span className="block text-[10px] leading-4 text-muted">{choice.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label="Commentaire"
          htmlFor="comment"
          hint="Obligatoire si la commande est partielle ou indisponible."
        >
          <textarea
            id="comment"
            name="comment"
            maxLength={maxComment}
            className={TEXTAREA_CLASS}
            placeholder="Quantités disponibles, date de réapprovisionnement, remarques…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Délai proposé (jours)"
            htmlFor="leadTimeDays"
            hint="Entier de 0 à 365, facultatif."
          >
            <input
              id="leadTimeDays"
              name="leadTimeDays"
              type="number"
              min={0}
              max={365}
              step={1}
              inputMode="numeric"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Montant total proposé (XOF)"
            htmlFor="proposedTotalXof"
            hint="Entier en francs CFA, facultatif."
          >
            <input
              id="proposedTotalXof"
              name="proposedTotalXof"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field
          label="Pièce jointe"
          htmlFor="attachment"
          hint={`PDF, PNG, JPEG ou XLSX, ${Math.round(maxAttachmentBytes / (1024 * 1024))} Mio maximum.`}
        >
          <input
            id="attachment"
            name="attachment"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[11px] text-muted file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-1 file:text-[11px] file:text-ink"
          />
        </Field>
      </fieldset>

      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        <p className="text-[10px] leading-4 text-muted">
          Votre réponse est transmise immédiatement à l&apos;acheteur.
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-label="Envoyer la réponse"
          title="Envoyer la réponse"
          className="grid size-9 place-items-center rounded-md border border-brand/20 bg-brand-soft text-brand-strong transition-colors hover:border-brand/40 disabled:opacity-60"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
