"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { createExchangeTemplateAction, updateExchangeTemplateAction } from "@/lib/exchange/actions";
import { EMPTY_EXCHANGE_FORM_STATE } from "@/lib/exchange/form-state";
import type { ExchangeTemplateSummary } from "@/modules/exchange/queries";
import {
  renderExchangeLines,
  renderExchangeTemplate,
  sampleTemplateValues,
} from "@/modules/exchange/render";
import { EXCHANGE_TYPE_LABELS } from "@/modules/exchange/templates";
import { EXCHANGE_TYPES, MAX_SUBJECT, MAX_TEMPLATE_BODY } from "@/modules/exchange/validation";
import { TEMPLATE_VARIABLES } from "@/modules/exchange/variables";

const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-56 resize-y font-mono text-[12px] leading-5`;

const SAMPLE_LINES = renderExchangeLines([
  {
    lineNumber: 1,
    name: "Café vert Arabica",
    unitCode: "KG",
    qty: "120",
    unitPriceLabel: "2 500 F CFA",
    totalLabel: "300 000 F CFA",
  },
  {
    lineNumber: 2,
    name: "Transport maritime",
    unitCode: "FOR",
    qty: "1",
    unitPriceLabel: "75 000 F CFA",
    totalLabel: "75 000 F CFA",
  },
]);

const SAMPLE_VALUES = sampleTemplateValues();

export function TemplateForm({ template }: { template: ExchangeTemplateSummary | null }) {
  const [state, formAction, pending] = useActionState(
    template ? updateExchangeTemplateAction : createExchangeTemplateAction,
    EMPTY_EXCHANGE_FORM_STATE,
  );
  const [type, setType] = useState(template?.type ?? "purchase_request");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");

  const preview = renderExchangeTemplate(subject, body, SAMPLE_VALUES, SAMPLE_LINES);

  return (
    <form action={formAction} className="space-y-5">
      {template ? <input type="hidden" name="templateId" value={template.id} /> : null}
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5 rounded-xl border border-line bg-panel p-5">
          <fieldset disabled={pending} className="space-y-5">
            <legend className="sr-only">Modèle d&apos;échange</legend>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Nom"
                htmlFor="templateName"
                hint="Unique dans l'espace, 120 caractères max."
              >
                <input
                  id="templateName"
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={template?.name ?? ""}
                  placeholder="Demande de prix standard"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field
                label="Type"
                htmlFor="templateType"
                hint="Détermine le statut de commande accepté."
              >
                <select
                  id="templateType"
                  name="type"
                  value={type}
                  onChange={(event) => setType(event.target.value as typeof type)}
                  className={INPUT_CLASS}
                >
                  {EXCHANGE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {EXCHANGE_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label="Sujet"
              htmlFor="subject"
              hint={`${MAX_SUBJECT} caractères maximum, sans retour à la ligne.`}
            >
              <input
                id="subject"
                name="subject"
                required
                maxLength={MAX_SUBJECT}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Demande de prix — {{company.legal_name}}"
                className={`${INPUT_CLASS} font-mono text-[12px]`}
              />
            </Field>

            <Field
              label="Corps"
              htmlFor="body"
              hint={`${MAX_TEMPLATE_BODY} caractères maximum. {{order.lines}} insère le tableau des lignes.`}
            >
              <textarea
                id="body"
                name="body"
                required
                maxLength={MAX_TEMPLATE_BODY}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={"Bonjour {{supplier.contact}},\n\n{{order.lines}}\n\nCordialement,"}
                className={TEXTAREA_CLASS}
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <CheckboxField
                name="isDefault"
                label="Modèle par défaut"
                hint="Retire le défaut du même type."
                defaultChecked={template?.isDefault ?? false}
              />
              <CheckboxField
                name="active"
                label="Modèle actif"
                hint="Un modèle inactif n'est jamais proposé."
                defaultChecked={template?.active ?? true}
              />
            </div>
          </fieldset>

          <div className="flex items-center justify-between border-t border-line pt-4">
            <Link
              href="/parametres/echanges"
              aria-label="Revenir aux échanges"
              title="Revenir aux échanges"
              className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <button
              type="submit"
              disabled={pending}
              aria-label={template ? "Mettre à jour le modèle" : "Créer le modèle"}
              title={template ? "Mettre à jour le modèle" : "Créer le modèle"}
              className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Aperçu</h2>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Rendu avec des valeurs d&apos;exemple ; un envoi réel utilise la commande et la fiche
              entreprise.
            </p>
            <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[11px] break-words">
              {preview.subject || "—"}
            </p>
            <div
              className="mt-3 rounded-md border border-line bg-white px-3 py-2 text-[12px] leading-5 text-black"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </section>

          <section className="rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Variables disponibles</h2>
            <p className="mt-1 text-[10px] leading-4 text-muted">
              Une variable inconnue bloque l&apos;enregistrement.
            </p>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {(["Entreprise", "Fournisseur", "Commande", "Document", "Acteur"] as const).map(
                (group) => (
                  <div key={group}>
                    <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      {group}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {TEMPLATE_VARIABLES.filter((variable) => variable.group === group).map(
                        (variable) => (
                          <li
                            key={variable.token}
                            className="flex items-baseline justify-between gap-2"
                          >
                            <code className="font-mono text-[10px] text-brand-strong">
                              {`{{${variable.token}}}`}
                            </code>
                            <span className="text-right text-[10px] text-muted">
                              {variable.label}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                ),
              )}
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
}
