import { isCountryCode } from "./constants";

export interface PartnerBankAccountData {
  readonly bankName: string | null;
  readonly bankCountryCode: string | null;
  readonly accountHolder: string | null;
  readonly bankCode: string | null;
  readonly branchCode: string | null;
  readonly accountNumber: string | null;
  readonly ribKey: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
}

function optionalText(raw: unknown, label: string, max: number, errors: string[]): string | null {
  const value = String(raw ?? "").trim();
  if (value.length > max) {
    errors.push(`${label} : ${max} caractères maximum.`);
    return null;
  }
  return value || null;
}

function validIban(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const moved = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const character of moved) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** ART-024 — coordonnées bancaires facultatives, mais cohérentes dès qu'un compte est saisi. */
export function validatePartnerBankAccount(raw: Record<string, unknown>): {
  data: PartnerBankAccountData;
  errors: string[];
} {
  const errors: string[] = [];
  const bankName = optionalText(raw.bank_name, "Banque", 120, errors);
  const countryRaw = (
    optionalText(raw.bank_country_code, "Pays de la banque", 2, errors) ?? ""
  ).toUpperCase();
  let bankCountryCode: string | null = null;
  if (countryRaw) {
    if (!/^[A-Z]{2}$/.test(countryRaw) || !isCountryCode(countryRaw)) {
      errors.push("Le pays de la banque doit être un code ISO 3166-1 reconnu.");
    } else {
      bankCountryCode = countryRaw;
    }
  }
  const accountHolder = optionalText(raw.account_holder, "Intitulé du compte", 120, errors);
  const bankCode = optionalText(raw.bank_code, "Code banque", 20, errors);
  const branchCode = optionalText(raw.branch_code, "Code guichet", 20, errors);
  const accountNumber = optionalText(raw.account_number, "Numéro de compte", 34, errors);
  const ribKey = optionalText(raw.rib_key, "Clé RIB", 2, errors);
  const iban = optionalText(raw.iban, "IBAN", 34, errors)?.replace(/\s/g, "").toUpperCase() ?? null;
  const bic =
    optionalText(raw.bic, "BIC / SWIFT", 11, errors)?.replace(/\s/g, "").toUpperCase() ?? null;

  if (ribKey && !/^\d{1,2}$/.test(ribKey))
    errors.push("La clé RIB contient au plus deux chiffres.");
  if (iban && !validIban(iban)) errors.push("L'IBAN est invalide (format ou clé de contrôle).");
  if (bic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
    errors.push("Le BIC / SWIFT contient 8 ou 11 caractères alphanumériques.");
  }

  const hasAnyData = Boolean(
    bankName ||
    bankCountryCode ||
    accountHolder ||
    bankCode ||
    branchCode ||
    accountNumber ||
    ribKey ||
    iban ||
    bic,
  );
  if (hasAnyData && !accountHolder) errors.push("Renseignez l'intitulé du compte bancaire.");
  if (hasAnyData && !accountNumber && !iban) {
    errors.push("Renseignez un numéro de compte ou un IBAN.");
  }

  return {
    data: {
      bankName,
      bankCountryCode,
      accountHolder,
      bankCode,
      branchCode,
      accountNumber,
      ribKey,
      iban,
      bic,
    },
    errors,
  };
}
