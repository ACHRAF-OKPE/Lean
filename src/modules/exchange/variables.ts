export interface TemplateVariable {
  readonly token: string;
  readonly label: string;
  readonly sample: string;
  readonly group: "Entreprise" | "Fournisseur" | "Commande" | "Document" | "Acteur";
}

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  {
    token: "company.legal_name",
    label: "Raison sociale",
    sample: "Lean SARL",
    group: "Entreprise",
  },
  { token: "company.legal_form", label: "Forme juridique", sample: "SARL", group: "Entreprise" },
  {
    token: "company.address",
    label: "Adresse",
    sample: "Boulevard Valéry Giscard d'Estaing",
    group: "Entreprise",
  },
  { token: "company.city", label: "Ville", sample: "Abidjan", group: "Entreprise" },
  { token: "company.country", label: "Pays", sample: "Côte d'Ivoire", group: "Entreprise" },
  {
    token: "company.email",
    label: "E-mail entreprise",
    sample: "contact@lean.test",
    group: "Entreprise",
  },
  {
    token: "company.phone",
    label: "Téléphone entreprise",
    sample: "+225 27 20 00 00 00",
    group: "Entreprise",
  },
  { token: "company.tax_id", label: "Numéro fiscal", sample: "CI-1234567 A", group: "Entreprise" },
  { token: "company.rccm", label: "RCCM", sample: "CI-ABJ-2026-B-00001", group: "Entreprise" },
  {
    token: "company.payment_terms",
    label: "Conditions de règlement",
    sample: "30 jours",
    group: "Entreprise",
  },
  { token: "company.incoterm", label: "Incoterm par défaut", sample: "FOB", group: "Entreprise" },
  { token: "company.bank_name", label: "Banque", sample: "Banque Atlantique", group: "Entreprise" },
  {
    token: "company.bank_account",
    label: "Numéro de compte",
    sample: "CI001234567890123456789",
    group: "Entreprise",
  },
  { token: "company.bank_swift", label: "SWIFT / BIC", sample: "ATCIABID", group: "Entreprise" },
  {
    token: "company.footer",
    label: "Mentions de facture",
    sample: "Règlement par virement uniquement.",
    group: "Entreprise",
  },
  {
    token: "supplier.name",
    label: "Nom du fournisseur",
    sample: "Sahel Négoce SARL",
    group: "Fournisseur",
  },
  { token: "supplier.code", label: "Code fournisseur", sample: "FOUR001", group: "Fournisseur" },
  {
    token: "supplier.contact",
    label: "Contact principal",
    sample: "Mariam Traoré",
    group: "Fournisseur",
  },
  {
    token: "supplier.email",
    label: "E-mail fournisseur",
    sample: "mariam@sahel.test",
    group: "Fournisseur",
  },
  {
    token: "supplier.address",
    label: "Adresse fournisseur",
    sample: "Zone industrielle de Yopougon",
    group: "Fournisseur",
  },
  { token: "supplier.city", label: "Ville fournisseur", sample: "Abidjan", group: "Fournisseur" },
  {
    token: "supplier.country",
    label: "Pays fournisseur",
    sample: "Côte d'Ivoire",
    group: "Fournisseur",
  },
  {
    token: "order.number",
    label: "Numéro de commande (après confirmation)",
    sample: "CMD-2026-0001",
    group: "Commande",
  },
  { token: "order.date", label: "Date de commande", sample: "26/10/2026", group: "Commande" },
  {
    token: "order.expected_date",
    label: "Réception prévue",
    sample: "05/11/2026",
    group: "Commande",
  },
  {
    token: "order.external_reference",
    label: "Référence externe",
    sample: "REF-FOUR-001",
    group: "Commande",
  },
  {
    token: "order.notes",
    label: "Notes",
    sample: "Merci de livrer avant midi.",
    group: "Commande",
  },
  { token: "order.total", label: "Total commande", sample: "125 000 F CFA", group: "Commande" },
  { token: "order.line_count", label: "Nombre de lignes", sample: "2", group: "Commande" },
  {
    token: "order.lines",
    label: "Tableau des lignes",
    sample: "1. Café vert — 2 KG × 1 000 F CFA",
    group: "Commande",
  },
  {
    token: "document.link",
    label: "Lien vers la commande",
    sample: "https://lean-lilac.vercel.app/achats/…",
    group: "Document",
  },
  { token: "sender.name", label: "Nom de l'expéditeur", sample: "Awa Koné", group: "Acteur" },
] as const;

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const KNOWN_TOKENS = new Set(TEMPLATE_VARIABLES.map((variable) => variable.token));

export function extractTemplateVariables(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const token = match[1];
    if (token && !found.includes(token)) {
      found.push(token);
    }
  }
  return found;
}

export function unknownTemplateVariables(subject: string, body: string): readonly string[] {
  const tokens = [...extractTemplateVariables(subject), ...extractTemplateVariables(body)];
  return [...new Set(tokens)].filter((token) => !KNOWN_TOKENS.has(token));
}

export function variableSample(token: string): string {
  return TEMPLATE_VARIABLES.find((variable) => variable.token === token)?.sample ?? "";
}
