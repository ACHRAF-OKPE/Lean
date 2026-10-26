import type { RawImportRow, ValidationContext, ValidatedRow } from "@/modules/catalog/validation";
import type { ValidationResult } from "@/modules/catalog/validation";
import { computeLineTotal, parseQuantity } from "@/modules/stock/quantities";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";

export interface SalesLineImportData {
  customerCode: string;
  articleCode: string;
  qty: string;
  unitPriceXof: number;
  expectedDeliveryDate: string | null;
  externalReference: string | null;
}

const MAX_REFERENCE_LENGTH = 60;

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function codeOf(
  raw: unknown,
  label: string,
): { value: string | null; errors: string[]; warnings: string[] } {
  const text = textOf(raw);
  const value = text.toUpperCase();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value) {
    errors.push(`${label} : obligatoire.`);
    return { value: null, errors, warnings };
  }
  if (value !== text) {
    warnings.push(`${label} : normalisé en majuscules.`);
  }
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(value)) {
    errors.push(
      `${label} : 32 caractères maximum, lettres, chiffres, point, tiret, barre oblique ou souligné.`,
    );
  }
  return { value, errors, warnings };
}

function groupKey(data: SalesLineImportData): string {
  return [data.customerCode, data.expectedDeliveryDate ?? "", data.externalReference ?? ""].join(
    "|",
  );
}

function cleanGroupLabel(data: SalesLineImportData): string {
  const date = data.expectedDeliveryDate ? ` le ${data.expectedDeliveryDate}` : "";
  const reference = data.externalReference ? ` (réf. ${data.externalReference})` : "";
  return `${data.customerCode}${date}${reference}`;
}

export function validateSalesLines(
  rows: readonly RawImportRow[],
  context: ValidationContext,
  today: string = todayIsoDate(),
): ValidationResult {
  const customers = context.customersByCode ?? new Map();
  const articles = context.salesArticlesByCode ?? new Map();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const customerCode = codeOf(row.values["client"], "Client");
    const articleCode = codeOf(row.values["article"], "Article");
    errors.push(...customerCode.errors, ...articleCode.errors);
    warnings.push(...customerCode.warnings, ...articleCode.warnings);

    if (customerCode.value) {
      const customer = customers.get(customerCode.value);
      if (!customer) {
        errors.push(`Client ${customerCode.value} introuvable dans cet espace.`);
      } else if (!customer.active) {
        errors.push(`Le client ${customerCode.value} est inactif.`);
      } else if (!customer.isCustomer) {
        errors.push(`Le tiers ${customerCode.value} n'a pas le rôle client.`);
      }
    }

    if (articleCode.value) {
      const article = articles.get(articleCode.value);
      if (!article) {
        errors.push(`Article ${articleCode.value} introuvable dans cet espace.`);
      } else if (!article.active) {
        errors.push(`L'article ${articleCode.value} est inactif.`);
      } else if (!article.isSellable) {
        errors.push(`L'article ${articleCode.value} n'est pas vendable.`);
      }
    }

    const quantity = parseQuantity(row.values["quantite"], "Quantité");
    const price = parseXofPrice(row.values["prix_unitaire_xof"], "Prix unitaire");
    errors.push(...quantity.errors, ...price.errors);
    warnings.push(...quantity.warnings, ...price.warnings);

    const expectedDate = parseIsoDate(
      row.values["date_livraison_prevue"],
      "Date de livraison prévue",
    );
    errors.push(...expectedDate.errors);
    warnings.push(...expectedDate.warnings);
    if (expectedDate.value && expectedDate.value < today) {
      warnings.push(
        `Date de livraison prévue ${expectedDate.value} déjà passée : vérifiez la date.`,
      );
    }

    const externalReference = textOf(row.values["reference_externe"]);
    if (externalReference.length > MAX_REFERENCE_LENGTH) {
      errors.push(`Référence externe : ${MAX_REFERENCE_LENGTH} caractères maximum.`);
    }

    const article = articleCode.value ? articles.get(articleCode.value) : undefined;
    let lineTotalXof = 0;
    if (quantity.value && price.errors.length === 0) {
      lineTotalXof = computeLineTotal(quantity.value, price.value);
      if (article && article.salePriceXof > 0 && price.value !== article.salePriceXof) {
        warnings.push(
          `Prix ${price.value} XOF différent du prix de vente de la fiche ${article.code} (${article.salePriceXof} XOF).`,
        );
      }
    }

    const data: SalesLineImportData = {
      customerCode: customerCode.value ?? "",
      articleCode: articleCode.value ?? "",
      qty: quantity.value ?? "",
      unitPriceXof: price.value,
      expectedDeliveryDate: expectedDate.value,
      externalReference: externalReference || null,
    };

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: articleCode.value ?? customerCode.value,
      errors,
      warnings,
      data: { ...data, lineTotalXof },
    };
  });

  const groups = new Map<string, ValidatedRow[]>();
  for (const row of validated) {
    if (row.errors.length > 0) {
      continue;
    }
    const data = row.data as unknown as SalesLineImportData;
    const key = groupKey(data);
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const notes: string[] = [];
  for (const group of groups.values()) {
    const positionsByArticle = new Map<string, number[]>();
    for (const row of group) {
      const data = row.data as unknown as SalesLineImportData;
      const positions = positionsByArticle.get(data.articleCode) ?? [];
      positions.push(row.rowNumber);
      positionsByArticle.set(data.articleCode, positions);
    }
    for (const [articleCode, positions] of positionsByArticle) {
      if (positions.length < 2) {
        continue;
      }
      for (const row of group) {
        const data = row.data as unknown as SalesLineImportData;
        if (data.articleCode !== articleCode) {
          continue;
        }
        row.warnings.push(
          `Article ${articleCode} présent plusieurs fois dans le même groupe (lignes ${positions.join(", ")}) : chaque ligne sera conservée.`,
        );
      }
    }
  }

  if (groups.size > 0) {
    const labels: string[] = [];
    for (const group of groups.values()) {
      labels.push(cleanGroupLabel(group[0]!.data as unknown as SalesLineImportData));
    }
    const visible = labels.slice(0, 5);
    const extra =
      labels.length > visible.length ? ` et ${labels.length - visible.length} autre(s)` : "";
    notes.push(
      `${groups.size} commande${groups.size > 1 ? "s" : ""} client en brouillon seront créées à la confirmation : ${visible.join(" ; ")}${extra}.`,
    );
  }

  for (const row of validated) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}
