import { isCountryCode, MAX_PAYMENT_TERM_DAYS, MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { INCOTERMS, isIncoterm, type Incoterm } from "@/modules/sales/validation";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ().-]+$/;
const BANK_ACCOUNT_PATTERN = /^[A-Z0-9]{5,34}$/;
const SWIFT_PATTERN = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;

export const MAX_LOGO_BYTES = 512 * 1024;

export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMime = (typeof LOGO_MIME_TYPES)[number];

export interface CompanyProfileData {
  legalName: string;
  legalForm: string | null;
  capitalXof: number | null;
  taxId: string | null;
  rccm: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  invoiceFooter: string | null;
  paymentTermDays: number;
  defaultIncoterm: Incoterm | null;
  bankName: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankSwift: string | null;
}

export interface PartnerContactData {
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  active: boolean;
}

export interface SettingsValidation<T> {
  readonly data: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function clean(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function singleSpaces(value: string): string {
  return value.replace(/\s+/g, " ");
}

function optionalLimited(
  raw: unknown,
  label: string,
  max: number,
  errors: string[],
  warnings: string[],
): string | null {
  const value = singleSpaces(clean(raw));
  if (!value) {
    return null;
  }
  if (value !== clean(raw)) {
    warnings.push(`${label} : espaces superflus normalisés.`);
  }
  if (value.length > max) {
    errors.push(`${label} : ${max} caractères maximum.`);
  }
  return value;
}

function optionalEmail(raw: unknown, errors: string[], warnings: string[]): string | null {
  const value = clean(raw).toLowerCase();
  if (!value) {
    return null;
  }
  if (value !== clean(raw)) {
    warnings.push("E-mail normalisé en minuscules.");
  }
  if (value.length > 160 || !EMAIL_PATTERN.test(value)) {
    errors.push("E-mail : adresse invalide.");
    return null;
  }
  return value;
}

function optionalPhone(raw: unknown, errors: string[]): string | null {
  const value = clean(raw);
  if (!value) {
    return null;
  }
  if (value.length > 30 || !PHONE_PATTERN.test(value) || !/\d/.test(value)) {
    errors.push("Téléphone : 30 caractères maximum, chiffres et séparateurs autorisés.");
    return null;
  }
  return value;
}

function optionalWebsite(raw: unknown, errors: string[], warnings: string[]): string | null {
  let value = clean(raw);
  if (!value) {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
    warnings.push("Site web : schéma https:// ajouté.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocol");
    }
    if (url.username || url.password) {
      errors.push("Site web : identifiants intégrés à l'adresse refusés.");
      return null;
    }
    if (!url.hostname.includes(".") && url.hostname !== "localhost") {
      errors.push("Site web : nom de domaine attendu.");
      return null;
    }
  } catch {
    errors.push("Site web : adresse HTTP(S) invalide.");
    return null;
  }
  if (value.length > 200) {
    errors.push("Site web : 200 caractères maximum.");
    return null;
  }
  return value;
}

function optionalCountry(raw: unknown, errors: string[], warnings: string[]): string | null {
  const value = clean(raw).toUpperCase();
  if (!value) {
    return null;
  }
  if (!isCountryCode(value)) {
    errors.push("Pays : code ISO 3166-1 à deux lettres attendu.");
    return null;
  }
  if (value !== clean(raw)) {
    warnings.push("Pays normalisé en majuscules.");
  }
  return value;
}

function parseOptionalCapital(raw: unknown, errors: string[], warnings: string[]): number | null {
  const text = clean(raw);
  if (!text) {
    return null;
  }
  const compact = text.replace(/[\s\u00a0\u202f]/g, "");
  if (compact !== text) {
    warnings.push("Capital : espaces de séparation retirés.");
  }
  if (!/^\d+$/.test(compact)) {
    errors.push("Capital : montant XOF entier attendu, sans décimale.");
    return null;
  }
  const value = Number(compact);
  if (!Number.isSafeInteger(value) || value > MAX_XOF_AMOUNT) {
    errors.push(`Capital : montant compris entre 0 et ${MAX_XOF_AMOUNT} attendu.`);
    return null;
  }
  return value;
}

function parsePaymentTerm(raw: unknown, errors: string[]): number {
  const text = clean(raw);
  if (!text) {
    return 0;
  }
  if (!/^\d+$/.test(text)) {
    errors.push("Délai de règlement : nombre entier de jours attendu.");
    return 0;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > MAX_PAYMENT_TERM_DAYS) {
    errors.push(`Délai de règlement : entier entre 0 et ${MAX_PAYMENT_TERM_DAYS} attendu.`);
    return 0;
  }
  return value;
}

function parseIncoterm(raw: unknown, errors: string[], warnings: string[]): Incoterm | null {
  const value = clean(raw).toUpperCase();
  if (!value) {
    return null;
  }
  if (!isIncoterm(value)) {
    errors.push(`Incoterm inconnu : liste Incoterms 2020 attendue (${INCOTERMS.join(", ")}).`);
    return null;
  }
  if (value !== clean(raw)) {
    warnings.push("Incoterm normalisé en majuscules.");
  }
  return value;
}

export function validateCompanyProfile(
  raw: Record<string, unknown>,
): SettingsValidation<CompanyProfileData> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawLegalName = clean(raw.legalName);
  const legalName = singleSpaces(rawLegalName);
  if (!legalName) {
    errors.push("Raison sociale : obligatoire.");
  } else if (legalName.length > 160) {
    errors.push("Raison sociale : 160 caractères maximum.");
  } else if (legalName !== rawLegalName) {
    warnings.push("Raison sociale : espaces superflus normalisés.");
  }

  const profile: CompanyProfileData = {
    legalName,
    legalForm: optionalLimited(raw.legalForm, "Forme juridique", 120, errors, warnings),
    capitalXof: parseOptionalCapital(raw.capitalXof, errors, warnings),
    taxId: optionalLimited(raw.taxId, "Numéro fiscal", 40, errors, warnings),
    rccm: optionalLimited(raw.rccm, "RCCM", 40, errors, warnings),
    addressLine: optionalLimited(raw.addressLine, "Adresse", 200, errors, warnings),
    city: optionalLimited(raw.city, "Ville", 80, errors, warnings),
    postalCode: optionalLimited(raw.postalCode, "Code postal", 16, errors, warnings),
    countryCode: optionalCountry(raw.countryCode, errors, warnings),
    email: optionalEmail(raw.email, errors, warnings),
    phone: optionalPhone(raw.phone, errors),
    website: optionalWebsite(raw.website, errors, warnings),
    invoiceFooter: optionalLimited(raw.invoiceFooter, "Mentions de facture", 500, errors, warnings),
    paymentTermDays: parsePaymentTerm(raw.paymentTermDays, errors),
    defaultIncoterm: parseIncoterm(raw.defaultIncoterm, errors, warnings),
    bankName: null,
    bankAccountHolder: null,
    bankAccountNumber: null,
    bankSwift: null,
  };

  const bankName = optionalLimited(raw.bankName, "Banque", 80, errors, warnings);
  const bankAccountHolder = optionalLimited(
    raw.bankAccountHolder,
    "Titulaire du compte",
    120,
    errors,
    warnings,
  );
  const rawAccount = clean(raw.bankAccountNumber);
  const account = rawAccount.replace(/[\s\u00a0\u202f]/g, "").toUpperCase();
  if (account && account !== rawAccount) {
    warnings.push("Numéro de compte normalisé en majuscules, sans espaces.");
  }
  if (account && !BANK_ACCOUNT_PATTERN.test(account)) {
    errors.push("Numéro de compte : 5 à 34 caractères alphanumériques attendus.");
  }
  const rawSwift = clean(raw.bankSwift);
  const swift = rawSwift.replace(/[\s\u00a0\u202f]/g, "").toUpperCase();
  if (swift && swift !== rawSwift) {
    warnings.push("SWIFT/BIC normalisé en majuscules, sans espaces.");
  }
  if (swift && !SWIFT_PATTERN.test(swift)) {
    errors.push("SWIFT/BIC : 8 ou 11 caractères alphanumériques attendus.");
  }

  const bankFields = [bankName, bankAccountHolder, account].filter(Boolean);
  if ((bankFields.length > 0 || swift) && bankFields.length < 3) {
    errors.push("Coordonnées bancaires : banque, titulaire et numéro de compte vont ensemble.");
  } else if (bankFields.length === 3 && BANK_ACCOUNT_PATTERN.test(account)) {
    profile.bankName = bankName;
    profile.bankAccountHolder = bankAccountHolder;
    profile.bankAccountNumber = account;
    profile.bankSwift = SWIFT_PATTERN.test(swift) ? swift : null;
  }

  return { data: profile, errors, warnings };
}

export function validatePartnerContact(
  raw: Record<string, unknown>,
): SettingsValidation<PartnerContactData> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawFullName = clean(raw.fullName);
  const fullName = singleSpaces(rawFullName);
  if (!fullName) {
    errors.push("Nom du contact : obligatoire.");
  } else if (fullName.length > 120) {
    errors.push("Nom du contact : 120 caractères maximum.");
  } else if (fullName !== rawFullName) {
    warnings.push("Nom du contact : espaces superflus normalisés.");
  }

  const email = optionalEmail(raw.email, errors, warnings);
  const phone = optionalPhone(raw.phone, errors);
  if (!email && !phone) {
    warnings.push("Contact sans e-mail ni téléphone : aucun moyen de le joindre.");
  }

  const active = raw.active !== false && raw.active !== "false";
  const isPrimary = raw.isPrimary === true || raw.isPrimary === "true" || raw.isPrimary === "on";
  if (isPrimary && !active) {
    errors.push("Un contact principal doit être actif.");
  }

  return {
    data: {
      fullName,
      jobTitle: optionalLimited(raw.jobTitle, "Fonction", 80, errors, warnings),
      email,
      phone,
      isPrimary,
      active,
    },
    errors,
    warnings,
  };
}

export function detectLogoMime(bytes: Uint8Array): LogoMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateLogo(input: {
  bytes: Uint8Array;
  declaredMime?: string | null;
}): SettingsValidation<{ mime: LogoMime | null; bytes: Uint8Array }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.bytes.length === 0) {
    errors.push("Logo : fichier vide.");
  } else if (input.bytes.length > MAX_LOGO_BYTES) {
    errors.push("Logo : 512 Kio maximum.");
  }

  const mime = detectLogoMime(input.bytes);
  if (!mime) {
    errors.push("Logo : PNG, JPEG ou WebP attendu (signature binaire non reconnue).");
  }
  const declared = clean(input.declaredMime).toLowerCase();
  if (mime && declared && declared !== mime) {
    warnings.push(`Logo : type déclaré ${declared} ignoré, signature ${mime}.`);
  }

  return { data: { mime, bytes: input.bytes }, errors, warnings };
}
