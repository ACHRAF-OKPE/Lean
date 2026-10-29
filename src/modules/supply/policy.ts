import { parseQuantity } from "@/modules/stock/quantities";

export interface SupplyPolicyRaw {
  readonly supplierId?: unknown;
  readonly leadTimeDays?: unknown;
  readonly safetyDelayDays?: unknown;
  readonly minStockQty?: unknown;
  readonly reorderQty?: unknown;
  readonly orderMultipleQty?: unknown;
}

export interface SupplyPolicyValues {
  readonly supplierId: string;
  readonly leadTimeDays: number;
  readonly safetyDelayDays: number;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly orderMultipleQty: string | null;
}

export interface SupplyPolicyParseResult {
  readonly values: SupplyPolicyValues | null;
  readonly errors: string[];
  readonly warnings: string[];
}

export interface SupplyArticleReference {
  readonly code: string;
  readonly type: string;
  readonly active: boolean;
  readonly isPurchasable: boolean;
}

export interface SupplySupplierReference {
  readonly code: string;
  readonly active: boolean;
  readonly isSupplier: boolean;
}

function parseDays(raw: unknown, label: string, max: number, errors: string[]): number {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return 0;
  }
  if (!/^\d+$/.test(text)) {
    errors.push(`${label} : nombre entier de jours attendu.`);
    return 0;
  }
  const value = Number(text);
  if (value > max) {
    errors.push(`${label} : ${max} jours maximum.`);
    return 0;
  }
  return value;
}

export function parseSupplyPolicy(raw: SupplyPolicyRaw): SupplyPolicyParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const supplierId = typeof raw.supplierId === "string" ? raw.supplierId.trim() : "";
  if (!supplierId) {
    errors.push("Fournisseur par défaut : obligatoire.");
  }

  const leadTimeDays = parseDays(raw.leadTimeDays, "Délai d'approvisionnement", 365, errors);
  const safetyDelayDays = parseDays(raw.safetyDelayDays, "Délai de sécurité", 60, errors);

  const minStock = parseQuantity(raw.minStockQty ?? "", "Stock minimum", { allowZero: true });
  const reorder = parseQuantity(raw.reorderQty ?? "", "Quantité de réapprovisionnement", {
    allowZero: true,
  });
  errors.push(...minStock.errors, ...reorder.errors);
  warnings.push(...minStock.warnings, ...reorder.warnings);

  const multipleRaw = raw.orderMultipleQty;
  const multipleText =
    typeof multipleRaw === "number"
      ? String(multipleRaw)
      : typeof multipleRaw === "string"
        ? multipleRaw.trim()
        : "";
  let orderMultipleQty: string | null = null;
  if (multipleText) {
    const multiple = parseQuantity(multipleText, "Multiple de commande");
    errors.push(...multiple.errors);
    warnings.push(...multiple.warnings);
    orderMultipleQty = multiple.value;
  }

  if (errors.length > 0 || !minStock.value || !reorder.value) {
    return { values: null, errors, warnings };
  }

  return {
    values: {
      supplierId,
      leadTimeDays,
      safetyDelayDays,
      minStockQty: minStock.value,
      reorderQty: reorder.value,
      orderMultipleQty,
    },
    errors,
    warnings,
  };
}

export function validateSupplyPolicyTarget(input: {
  article: SupplyArticleReference | null;
  supplier: SupplySupplierReference | null;
}): string[] {
  const errors: string[] = [];
  const { article, supplier } = input;

  if (!article) {
    errors.push("Article introuvable dans cet espace de travail.");
  } else if (article.type !== "product") {
    errors.push(
      `L'article ${article.code} est un service : il ne relève pas de l'approvisionnement.`,
    );
  } else if (!article.active) {
    errors.push(`L'article ${article.code} est inactif.`);
  } else if (!article.isPurchasable) {
    errors.push(`L'article ${article.code} n'est pas achetable.`);
  }

  if (!supplier) {
    errors.push("Fournisseur introuvable dans cet espace de travail.");
  } else if (!supplier.active) {
    errors.push(`Le fournisseur ${supplier.code} est inactif.`);
  } else if (!supplier.isSupplier) {
    errors.push(`Le tiers ${supplier.code} ne porte pas le rôle fournisseur.`);
  }

  return errors;
}

export function parseDismissReason(raw: unknown): { reason: string | null; error: string | null } {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) {
    return { reason: null, error: "Motif : obligatoire pour écarter une proposition." };
  }
  if (reason.length > 500) {
    return { reason: null, error: "Motif : 500 caractères maximum." };
  }
  return { reason, error: null };
}
