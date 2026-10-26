import type { ExchangeType } from "@/db/schema";

export const EXCHANGE_TYPE_LABELS: Record<ExchangeType, string> = {
  purchase_request: "Demande fournisseur",
  purchase_confirmation: "Confirmation fournisseur",
};

export interface BuiltinExchangeTemplate {
  readonly name: string;
  readonly subject: string;
  readonly body: string;
}

export const BUILTIN_TEMPLATES: Record<ExchangeType, BuiltinExchangeTemplate> = {
  purchase_request: {
    name: "Modèle intégré — demande",
    subject: "Demande de prix — {{company.legal_name}}",
    body: [
      "Bonjour {{supplier.contact}},",
      "",
      "{{company.legal_name}} vous adresse une demande de prix pour les articles suivants.",
      "",
      "{{order.lines}}",
      "",
      "Merci de nous confirmer vos prix, vos disponibilités et vos délais.",
      "",
      "Cordialement,",
      "{{sender.name}}",
      "{{company.legal_name}}",
    ].join("\n"),
  },
  purchase_confirmation: {
    name: "Modèle intégré — confirmation",
    subject: "Confirmation de commande {{order.number}}",
    body: [
      "Bonjour {{supplier.contact}},",
      "",
      "Nous confirmons la commande {{order.number}} du {{order.date}} pour un montant de {{order.total}}.",
      "",
      "{{order.lines}}",
      "",
      "Conditions de règlement : {{company.payment_terms}}.",
      "",
      "Cordialement,",
      "{{sender.name}}",
      "{{company.legal_name}}",
    ].join("\n"),
  },
};

export function builtinExchangeTemplate(type: ExchangeType): BuiltinExchangeTemplate {
  return BUILTIN_TEMPLATES[type];
}
