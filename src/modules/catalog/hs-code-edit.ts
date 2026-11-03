import { isTecRate } from "@/modules/customs/constants";
import { HS_CODE_PATTERN } from "./hs-codes";

export const HS_MAX_WORDING = 240;
export const HS_MAX_SUPPLEMENTARY_UNIT = 30;

export interface HsCodeEditData {
  readonly wording: string;
  readonly parentCode: string | null;
  readonly supplementaryUnit: string | null;
  readonly tecRate: number | null;
}

function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * ART-022 — la fiche d'un code SH se corrige avec les mêmes bornes que sa création, le code excepté :
 * libellé obligatoire, parent facultatif mais préfixe strict du code, unité bornée, TEC de la bande UEMOA.
 */
export function validateHsCodeEdit(
  code: string,
  raw: Record<string, unknown>,
): { data: HsCodeEditData; errors: string[] } {
  const errors: string[] = [];

  const wording = text(raw.libelle);
  if (wording === "") {
    errors.push("Le libellé du code SH est obligatoire.");
  } else if (wording.length > HS_MAX_WORDING) {
    errors.push(`Le libellé dépasse ${HS_MAX_WORDING} caractères.`);
  }

  let parentCode: string | null = null;
  const parentRaw = text(raw.code_parent);
  if (parentRaw !== "") {
    if (!HS_CODE_PATTERN.test(parentRaw)) {
      errors.push("Le code parent compte 6, 8 ou 10 chiffres.");
    } else if (parentRaw.length >= code.length || !code.startsWith(parentRaw)) {
      errors.push("Le code parent doit être un préfixe strict du code SH.");
    } else {
      parentCode = parentRaw;
    }
  }

  const unitRaw = text(raw.unite_complementaire);
  let supplementaryUnit: string | null = null;
  if (unitRaw !== "") {
    if (unitRaw.length > HS_MAX_SUPPLEMENTARY_UNIT) {
      errors.push(`L'unité complémentaire dépasse ${HS_MAX_SUPPLEMENTARY_UNIT} caractères.`);
    } else {
      supplementaryUnit = unitRaw;
    }
  }

  let tecRate: number | null = null;
  const tecRaw = text(raw.taux_tec).replace("%", "").trim();
  if (tecRaw !== "") {
    const value = Number(tecRaw);
    if (!/^\d+(\.\d+)?$/.test(tecRaw) || !isTecRate(value)) {
      errors.push("Le taux TEC est 0, 5, 10, 20 ou 35 %.");
    } else {
      tecRate = value;
    }
  }

  return {
    data: { wording, parentCode, supplementaryUnit, tecRate },
    errors,
  };
}
