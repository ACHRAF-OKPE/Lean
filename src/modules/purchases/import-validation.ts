import type { RawImportRow, ValidationContext, ValidatedRow } from "@/modules/catalog/validation";
import type { ValidationResult } from "@/modules/catalog/validation";
import { computeLineTotal, parseQuantity } from "@/modules/stock/quantities";
import { todayIsoDate } from "@/lib/dates";
import { parseIsoDate, parseXofPrice } from "./validation";

export interface PurchaseLineImportData {
  supplierCode: string;
  articleCode: string;
  qty: string;
  unitPriceXof: number;
  expectedReceiptDate: string | null;
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

function groupKey(data: PurchaseLineImportData): string {
  return [data.supplierCode, data.expectedReceiptDate ?? "", data.externalReference ?? ""].join(
    "|",
  );
}

function cleanGroupLabel(data: PurchaseLineImportData): string {
  const date = data.expectedReceiptDate ? ` le ${data.expectedReceiptDate}` : "";
  const reference = data.externalReference ? ` (réf. ${data.externalReference})` : "";
  return `${data.supplierCode}${date}${reference}`;
}

export function validatePurchaseLines(
  rows: readonly RawImportRow[],
  context: ValidationContext,
  today: string = todayIsoDate(),
): ValidationResult {
  const suppliers = context.suppliersByCode ?? new Map();
  const articles = context.articlesByCode ?? new Map();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const supplierCode = codeOf(row.values["fournisseur"], "Fournisseur");
    const articleCode = codeOf(row.values["article"], "Article");
    errors.push(...supplierCode.errors, ...articleCode.errors);
    warnings.push(...supplierCode.warnings, ...articleCode.warnings);

    if (supplierCode.value) {
      const supplier = suppliers.get(supplierCode.value);
      if (!supplier) {
        errors.push(`Fournisseur ${supplierCode.value} introuvable dans cet espace.`);
      } else if (!supplier.active) {
        errors.push(`Le fournisseur ${supplierCode.value} est inactif.`);
      } else if (!supplier.isSupplier) {
        errors.push(`Le tiers ${supplierCode.value} n'a pas le rôle fournisseur.`);
      }
    }

    if (articleCode.value) {
      const article = articles.get(articleCode.value);
      if (!article) {
        errors.push(`Article ${articleCode.value} introuvable dans cet espace.`);
      } else if (!article.active) {
        errors.push(`L'article ${articleCode.value} est inactif.`);
      } else if (!article.isPurchasable) {
        errors.push(`L'article ${articleCode.value} n'est pas achetable.`);
      }
    }

    const quantity = parseQuantity(row.values["quantite"], "Quantité");
    const price = parseXofPrice(row.values["prix_unitaire_xof"], "Prix unitaire");
    errors.push(...quantity.errors, ...price.errors);
    warnings.push(...quantity.warnings, ...price.warnings);

    const expectedDate = parseIsoDate(
      row.values["date_reception_prevue"],
      "Date de réception prévue",
    );
    errors.push(...expectedDate.errors);
    warnings.push(...expectedDate.warnings);
    if (expectedDate.value && expectedDate.value < today) {
      warnings.push(
        `Date de réception prévue ${expectedDate.value} déjà passée : vérifiez la date.`,
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
      if (article && article.purchasePriceXof > 0 && price.value !== article.purchasePriceXof) {
        warnings.push(
          `Prix ${price.value} XOF différent du prix d'achat de la fiche ${article.code} (${article.purchasePriceXof} XOF).`,
        );
      }
    }

    const data: PurchaseLineImportData = {
      supplierCode: supplierCode.value ?? "",
      articleCode: articleCode.value ?? "",
      qty: quantity.value ?? "",
      unitPriceXof: price.value,
      expectedReceiptDate: expectedDate.value,
      externalReference: externalReference || null,
    };

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: articleCode.value ?? supplierCode.value,
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
    const data = row.data as unknown as PurchaseLineImportData;
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
      const data = row.data as unknown as PurchaseLineImportData;
      const positions = positionsByArticle.get(data.articleCode) ?? [];
      positions.push(row.rowNumber);
      positionsByArticle.set(data.articleCode, positions);
    }
    for (const [articleCode, positions] of positionsByArticle) {
      if (positions.length < 2) {
        continue;
      }
      for (const row of group) {
        const data = row.data as unknown as PurchaseLineImportData;
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
      labels.push(cleanGroupLabel(group[0]!.data as unknown as PurchaseLineImportData));
    }
    const visible = labels.slice(0, 5);
    const extra =
      labels.length > visible.length ? ` et ${labels.length - visible.length} autre(s)` : "";
    notes.push(
      `${groups.size} commande${groups.size > 1 ? "s" : ""} en brouillon seront créées à la confirmation : ${visible.join(" ; ")}${extra}.`,
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
