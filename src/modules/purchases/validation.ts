import type { ArticleType } from "@/db/schema";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { computeLineTotal, parseQuantity } from "@/modules/stock/quantities";

export interface SupplierReference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly isSupplier: boolean;
}

export interface ArticleReference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly active: boolean;
  readonly isPurchasable: boolean;
  readonly purchasePriceXof: number;
}

export interface ValidatedOrderLine {
  readonly articleId: string;
  readonly articleCode: string;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface DraftOrderLineInput {
  readonly articleId: string;
  readonly qty: unknown;
  readonly unitPriceXof: unknown;
}

export interface DraftOrderInput {
  readonly supplierId: string;
  readonly expectedReceiptDate: unknown;
  readonly externalReference: unknown;
  readonly notes: unknown;
  readonly lines: readonly DraftOrderLineInput[];
}

export interface ValidatedOrder {
  readonly supplier: SupplierReference;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly externalReference: string | null;
  readonly notes: string | null;
  readonly lines: readonly ValidatedOrderLine[];
  readonly exTaxTotal: number;
  readonly warnings: readonly string[];
}

export interface OrderValidationResult {
  readonly errors: readonly string[];
  readonly order: ValidatedOrder | null;
}

const MAX_ORDER_LINES = 100;

export function parseIsoDate(
  raw: unknown,
  label: string,
  required = false,
): { value: string | null; errors: string[]; warnings: string[] } {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!text) {
    return {
      value: null,
      errors: required ? [`${label} : obligatoire.`] : [],
      warnings: [],
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { value: null, errors: [`${label} : date AAAA-MM-JJ attendue.`], warnings: [] };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { value: null, errors: [`${label} : date invalide.`], warnings: [] };
  }
  return { value: text, errors: [], warnings: [] };
}

export function parseXofPrice(
  raw: unknown,
  label: string,
): { value: number; errors: string[]; warnings: string[] } {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!text) {
    errors.push(`${label} : obligatoire.`);
    return { value: 0, errors, warnings };
  }

  const compact = text.replace(/[\s\u00a0\u202f]/g, "");
  if (compact !== text) {
    warnings.push(`${label} : espaces de séparation retirés.`);
  }
  if (!/^\d+$/.test(compact)) {
    errors.push(`${label} : montant XOF entier attendu, sans décimale.`);
    return { value: 0, errors, warnings };
  }

  const value = Number(compact);
  if (!Number.isSafeInteger(value) || value > MAX_XOF_AMOUNT) {
    errors.push(`${label} : montant compris entre 0 et ${MAX_XOF_AMOUNT} attendu.`);
    return { value: 0, errors, warnings };
  }
  return { value, errors, warnings };
}

export function validateOrderLineValues(input: {
  readonly article: ArticleReference | null;
  readonly articleLabel: string;
  readonly qty: unknown;
  readonly unitPriceXof: unknown;
  readonly lineNumber: number;
}): { errors: string[]; warnings: string[]; line: ValidatedOrderLine | null } {
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
    if (!article.isPurchasable) {
      errors.push(`${prefix} : l'article ${article.code} n'est pas achetable.`);
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

  if (article.purchasePriceXof > 0 && price.value !== article.purchasePriceXof && qty.value) {
    warnings.push(
      `${prefix} : prix ${price.value} XOF différent du prix d'achat de la fiche (${article.purchasePriceXof} XOF).`,
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

export function validateDraftOrder(
  input: DraftOrderInput,
  references: {
    readonly today: string;
    readonly supplier: SupplierReference | null;
    readonly articlesById: ReadonlyMap<string, ArticleReference>;
  },
): OrderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.supplierId) {
    errors.push("Fournisseur : obligatoire.");
  }
  const supplier = references.supplier;
  if (input.supplierId && !supplier) {
    errors.push("Fournisseur introuvable dans cet espace de travail.");
  } else if (supplier) {
    if (!supplier.active) {
      errors.push(`Le fournisseur ${supplier.code} est inactif.`);
    }
    if (!supplier.isSupplier) {
      errors.push(`Le tiers ${supplier.code} n'a pas le rôle fournisseur.`);
    }
  }

  if (input.lines.length === 0) {
    errors.push("Commande : au moins une ligne est obligatoire.");
  }
  if (input.lines.length > MAX_ORDER_LINES) {
    errors.push(`Commande : ${MAX_ORDER_LINES} lignes maximum.`);
  }

  const expected = parseIsoDate(input.expectedReceiptDate, "Date de réception prévue");
  errors.push(...expected.errors);
  warnings.push(...expected.warnings);

  const externalReference =
    input.externalReference === null || input.externalReference === undefined
      ? ""
      : String(input.externalReference).trim();
  if (externalReference.length > 60) {
    errors.push("Référence fournisseur : 60 caractères maximum.");
  }

  const notes = input.notes === null || input.notes === undefined ? "" : String(input.notes).trim();
  if (notes.length > 1000) {
    errors.push("Notes : 1000 caractères maximum.");
  }

  const lines: ValidatedOrderLine[] = [];
  const seen = new Map<string, number[]>();
  input.lines.forEach((line, index) => {
    const article = references.articlesById.get(line.articleId) ?? null;
    const result = validateOrderLineValues({
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

  if (errors.length > 0 || !supplier) {
    return { errors, order: null };
  }

  return {
    errors,
    order: {
      supplier,
      orderDate: references.today,
      expectedReceiptDate: expected.value,
      externalReference: externalReference || null,
      notes: notes || null,
      lines,
      exTaxTotal,
      warnings,
    },
  };
}
