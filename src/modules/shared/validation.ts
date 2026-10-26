import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";

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
