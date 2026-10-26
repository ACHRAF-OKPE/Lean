"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, LoaderCircle, Send } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { sendPurchaseExchangeAction } from "@/lib/exchange/actions";
import { EMPTY_EXCHANGE_FORM_STATE } from "@/lib/exchange/form-state";
import { renderExchangeTemplate } from "@/modules/exchange/render";
import type { ExchangeTemplateChoice } from "@/modules/exchange/queries";
import type { ExchangeType } from "@/db/schema";
import { MAX_SUBJECT, MAX_TEMPLATE_BODY } from "@/modules/exchange/validation";

const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-64 resize-y font-mono text-[12px] leading-5`;

export function SendForm({
  orderId,
  type,
  typeLabel,
  recipients,
  templates,
  values,
  lines,
  attachmentName,
  backHref,
}: {
  orderId: string;
  type: ExchangeType;
  typeLabel: string;
  recipients: readonly { email: string; name: string; isPrimary: boolean }[];
  templates: readonly ExchangeTemplateChoice[];
  values: Readonly<Record<string, string>>;
  lines: { text: string; html: string };
  attachmentName: string;
  backHref: string;
}) {
  const [state, formAction, pending] = useActionState(
    sendPurchaseExchangeAction,
    EMPTY_EXCHANGE_FORM_STATE,
  );
  const [templateIndex, setTemplateIndex] = useState(0);
  const [subject, setSubject] = useState(templates[0]?.subject ?? "");
  const [body, setBody] = useState(templates[0]?.body ?? "");
  const current = templates[templateIndex] ?? templates[0];
  const preview = renderExchangeTemplate(subject, body, values, lines);

  function selectTemplate(index: number) {
    setTemplateIndex(index);
    const choice = templates[index];
    if (choice) {
      setSubject(choice.subject);
      setBody(choice.body);
    }
  }

  return (
    <form action={formAction} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="templateId" value={current?.id ?? ""} />

      <div className="space-y-5 rounded-xl border border-line bg-panel p-5">
        <FormErrors errors={state.errors} />

        <fieldset disabled={pending} className="space-y-4">
          <legend className="sr-only">Envoi au fournisseur</legend>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modèle" htmlFor="templateIndex" hint={`Type : ${typeLabel}.`}>
              <select
                id="templateIndex"
                value={templateIndex}
                onChange={(event) => selectTemplate(Number(event.target.value))}
                className={INPUT_CLASS}
              >
                {templates.map((template, index) => (
                  <option key={template.id ?? "builtin"} value={index}>
                    {template.name}
                    {template.builtin ? " (intégré)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Destinataire"
              htmlFor="recipient"
              hint="Contacts actifs du fournisseur ; une autre adresse reste possible."
            >
              <input
                id="recipient"
                name="recipient"
                type="email"
                required
                maxLength={160}
                list="recipient-options"
                autoComplete="off"
                defaultValue={recipients[0]?.email ?? ""}
                className={INPUT_CLASS}
              />
              <datalist id="recipient-options">
                {recipients.map((recipient) => (
                  <option key={recipient.email} value={recipient.email}>
                    {recipient.name}
                  </option>
                ))}
              </datalist>
            </Field>
          </div>

          <Field label="Sujet" htmlFor="sendSubject" hint={`${MAX_SUBJECT} caractères maximum.`}>
            <input
              id="sendSubject"
              name="subject"
              required
              maxLength={MAX_SUBJECT}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Corps"
            htmlFor="sendBody"
            hint="Variables remplacées à l'envoi ; {{order.lines}} devient le tableau des lignes."
          >
            <textarea
              id="sendBody"
              name="body"
              required
              maxLength={MAX_TEMPLATE_BODY}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </Field>

          <p className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-[10px] text-muted">
            <FileText className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
            Pièce jointe automatique : <span className="font-mono">{attachmentName}</span>
          </p>
        </fieldset>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <Link
            href={backHref}
            aria-label="Revenir à la commande"
            title="Revenir à la commande"
            className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <button
            type="submit"
            disabled={pending}
            aria-label="Envoyer au fournisseur"
            title="Envoyer au fournisseur"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <aside className="rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Aperçu</h2>
        <p className="mt-1 text-[10px] leading-4 text-muted">
          Rendu avec les valeurs réelles de la commande et de la fiche entreprise.
        </p>
        <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[11px] break-words">
          {preview.subject || "—"}
        </p>
        <div
          className="mt-3 rounded-md border border-line bg-white px-3 py-2 text-[12px] leading-5 text-black"
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      </aside>
    </form>
  );
}
