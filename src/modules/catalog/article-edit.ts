import type { ArticleType } from "@/db/schema";
import { isCountryCode, isUnitCode, MAX_XOF_AMOUNT } from "./constants";
import { hsCodeField } from "./validation";

const TYPE_BY_LABEL: Record<string, ArticleType> = {
  produit: "product",
  product: "product",
  service: "service",
};

export interface ArticleEditData {
  readonly name: string;
  readonly description: string | null;
  readonly type: ArticleType;
  readonly unitCode: string;
  readonly hsCode: string | null;
  readonly salePriceXof: number;
  readonly purchasePriceXof: number;
  readonly isSellable: boolean;
  readonly isPurchasable: boolean;
  readonly countryOfOrigin: string | null;
  readonly active: boolean;
}

function normalizeWord(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function text(raw: unknown, label: string, max: number, errors: string[]): string | null {
  const value = String(raw ?? "").trim();
  if (value === "") {
    return null;
  }
  if (value.length > max) {
    errors.push(`Le champ « ${label} » dépasse ${max} caractères.`);
    return null;
  }
  return value;
}

function flag(raw: unknown): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value === "on" || value === "oui" || value === "true" || value === "1";
}

function amount(raw: unknown, label: string, errors: string[]): number {
  const value = String(raw ?? "").trim();
  if (value === "") {
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    errors.push(`Le champ « ${label} » est un montant XOF entier, sans décimale.`);
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_XOF_AMOUNT) {
    errors.push(`Le champ « ${label} » dépasse ${MAX_XOF_AMOUNT} XOF.`);
    return 0;
  }
  return parsed;
}

/** ART-015 — la fiche d'un article se corrige avec les mêmes bornes que sa création, code excepté. */
export function validateArticleEdit(raw: Record<string, unknown>): {
  data: ArticleEditData;
  errors: string[];
} {
  const errors: string[] = [];

  const name = text(raw.designation, "Désignation", 160, errors);
  if (name === null) {
    errors.push("La désignation de l'article est obligatoire.");
  }

  const type = TYPE_BY_LABEL[normalizeWord(raw.type)];
  if (!type) {
    errors.push("Le type de l'article est Produit ou Service.");
  }

  const description = text(raw.description, "Description", 1000, errors);

  const unitRaw = String(raw.unite ?? "")
    .trim()
    .toUpperCase();
  const unitCode = unitRaw;
  if (unitRaw === "") {
    errors.push("L'unité de l'article est obligatoire.");
  } else if (!isUnitCode(unitRaw)) {
    errors.push("L'unité de l'article ne figure pas dans la liste autorisée.");
  }

  const hsCode = hsCodeField(raw.code_sh, type === "product");
  errors.push(...hsCode.errors);
  if (type === "service" && hsCode.value) {
    errors.push("Un service ne porte jamais de code SH.");
  }

  const salePriceXof = amount(raw.prix_vente_xof, "Prix de vente XOF", errors);
  const purchasePriceXof = amount(raw.prix_achat_xof, "Prix d'achat XOF", errors);

  const isSellable = flag(raw.vendable);
  const isPurchasable = flag(raw.achetable);
  if (!isSellable && !isPurchasable) {
    errors.push("Un article est au moins vendable ou achetable.");
  }

  const originRaw = String(raw.pays_origine ?? "")
    .trim()
    .toUpperCase();
  let countryOfOrigin: string | null = null;
  if (originRaw !== "") {
    if (!/^[A-Z]{2}$/.test(originRaw) || !isCountryCode(originRaw)) {
      errors.push(`Le pays « ${originRaw} » n'est pas un code ISO 3166-1 reconnu.`);
    } else {
      countryOfOrigin = originRaw;
    }
  }

  return {
    data: {
      name: name ?? "",
      description,
      type: type ?? "product",
      unitCode,
      hsCode: hsCode.value,
      salePriceXof,
      purchasePriceXof,
      isSellable,
      isPurchasable,
      countryOfOrigin,
      active: raw.actif === undefined ? true : flag(raw.actif),
    },
    errors,
  };
}
