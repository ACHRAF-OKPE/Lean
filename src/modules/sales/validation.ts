import type { ArticleType } from "@/db/schema";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import { computeLineTotal, parseQuantity } from "@/modules/stock/quantities";

export const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
] as const;

export type Incoterm = (typeof INCOTERMS)[number];

export function isIncoterm(value: string): value is Incoterm {
  return (INCOTERMS as readonly string[]).includes(value);
}

export interface CustomerReference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly isCustomer: boolean;
}

export interface SalesArticleReference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly active: boolean;
  readonly isSellable: boolean;
  readonly salePriceXof: number;
}

export interface ValidatedSalesLine {
  readonly articleId: string;
  readonly articleCode: string;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface DraftSalesLineInput {
  readonly articleId: string;
  readonly qty: unknown;
  readonly unitPriceXof: unknown;
}

export interface DraftSalesOrderInput {
  readonly customerId: string;
  readonly expectedDeliveryDate: unknown;
  readonly externalReference: unknown;
  readonly incoterm: unknown;
  readonly notes: unknown;
  readonly lines: readonly DraftSalesLineInput[];
}

export interface ValidatedSalesOrder {
  readonly customer: CustomerReference;
  readonly orderDate: string;
  readonly expectedDeliveryDate: string | null;
  readonly externalReference: string | null;
  readonly incoterm: Incoterm | null;
  readonly notes: string | null;
  readonly lines: readonly ValidatedSalesLine[];
  readonly exTaxTotal: number;
  readonly warnings: readonly string[];
}

export interface SalesOrderValidationResult {
  readonly errors: readonly string[];
  readonly order: ValidatedSalesOrder | null;
}

const MAX_ORDER_LINES = 100;

export function validateSalesLineValues(input: {
  readonly article: SalesArticleReference | null;
  readonly articleLabel: string;
  readonly qty: unknown;
  readonly unitPriceXof: unknown;
  readonly lineNumber: number;
}): { errors: string[]; warnings: string[]; line: ValidatedSalesLine | null } {
  const prefix = `Ligne ${input.lineNumber}`;
  const errors: string[] = [];
  const warnings: string[] = [];

  const article = input.article;
  if (!article) {
    errors.push(`${prefix} : article ${input.articleLabel} introuvable dans cet espace.`);
  } else {
    if (!article.active) {
      errors.push(`${prefix} : l'article ${article.code} est inactif.`);
    }
    if (!article.isSellable) {
      errors.push(`${prefix} : l'article ${article.code} n'est pas vendable.`);
    }
  }

  const qty = parseQuantity(input.qty, `${prefix} · quantité`);
  const price = parseXofPrice(input.unitPriceXof, `${prefix} · prix unitaire`);
  errors.push(...qty.errors, ...price.errors);
  warnings.push(...qty.warnings, ...price.warnings);

  if (!article || !qty.value || errors.length > 0) {
    return { errors, warnings, line: null };
  }

  const lineTotalXof = computeLineTotal(qty.value, price.value);
  if (lineTotalXof > MAX_XOF_AMOUNT) {
    errors.push(`${prefix} : total de ligne supérieur à ${MAX_XOF_AMOUNT} XOF.`);
    return { errors, warnings, line: null };
  }

  if (article.salePriceXof > 0 && price.value !== article.salePriceXof) {
    warnings.push(
      `${prefix} : prix ${price.value} XOF différent du prix de vente de la fiche (${article.salePriceXof} XOF).`,
    );
  }

  return {
    errors,
    warnings,
    line: {
      articleId: article.id,
      articleCode: article.code,
      name: article.name,
      unitCode: article.unitCode,
      qty: qty.value,
      unitPriceXof: price.value,
      lineTotalXof,
    },
  };
}

export function validateDraftSalesOrder(
  input: DraftSalesOrderInput,
  references: {
    readonly today: string;
    readonly customer: CustomerReference | null;
    readonly articlesById: ReadonlyMap<string, SalesArticleReference>;
  },
): SalesOrderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.customerId) {
    errors.push("Client : obligatoire.");
  }
  const customer = references.customer;
  if (input.customerId && !customer) {
    errors.push("Client introuvable dans cet espace de travail.");
  } else if (customer) {
    if (!customer.active) {
      errors.push(`Le client ${customer.code} est inactif.`);
    }
    if (!customer.isCustomer) {
      errors.push(`Le tiers ${customer.code} n'a pas le rôle client.`);
    }
  }

  if (input.lines.length === 0) {
    errors.push("Commande : au moins une ligne est obligatoire.");
  }
  if (input.lines.length > MAX_ORDER_LINES) {
    errors.push(`Commande : ${MAX_ORDER_LINES} lignes maximum.`);
  }

  const expected = parseIsoDate(input.expectedDeliveryDate, "Date de livraison prévue");
  errors.push(...expected.errors);
  warnings.push(...expected.warnings);

  const externalReference =
    input.externalReference === null || input.externalReference === undefined
      ? ""
      : String(input.externalReference).trim();
  if (externalReference.length > 60) {
    errors.push("Référence client : 60 caractères maximum.");
  }

  const incotermText =
    input.incoterm === null || input.incoterm === undefined
      ? ""
      : String(input.incoterm).trim().toUpperCase();
  let incoterm: Incoterm | null = null;
  if (incotermText) {
    if (!isIncoterm(incotermText)) {
      errors.push(`Incoterm ${incotermText} inconnu : liste Incoterms 2020 attendue.`);
    } else {
      incoterm = incotermText;
    }
  }

  const notes = input.notes === null || input.notes === undefined ? "" : String(input.notes).trim();
  if (notes.length > 1000) {
    errors.push("Notes : 1000 caractères maximum.");
  }

  const lines: ValidatedSalesLine[] = [];
  const seen = new Map<string, number[]>();
  input.lines.forEach((line, index) => {
    const article = references.articlesById.get(line.articleId) ?? null;
    const result = validateSalesLineValues({
      article,
      articleLabel: line.articleId || "(vide)",
      qty: line.qty,
      unitPriceXof: line.unitPriceXof,
      lineNumber: index + 1,
    });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.line) {
      lines.push(result.line);
      const positions = seen.get(result.line.articleId) ?? [];
      positions.push(index + 1);
      seen.set(result.line.articleId, positions);
    }
  });

  for (const [articleId, positions] of seen) {
    if (positions.length < 2) {
      continue;
    }
    const article = references.articlesById.get(articleId);
    warnings.push(
      `Article ${article?.code ?? articleId} présent sur plusieurs lignes (${positions.join(", ")}).`,
    );
  }

  const exTaxTotal = lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
  if (exTaxTotal > MAX_XOF_AMOUNT) {
    errors.push(`Commande : total supérieur à ${MAX_XOF_AMOUNT} XOF.`);
  }

  if (errors.length > 0 || !customer) {
    return { errors, order: null };
  }

  return {
    errors,
    order: {
      customer,
      orderDate: references.today,
      expectedDeliveryDate: expected.value,
      externalReference: externalReference || null,
      incoterm,
      notes: notes || null,
      lines,
      exTaxTotal,
      warnings,
    },
  };
}
