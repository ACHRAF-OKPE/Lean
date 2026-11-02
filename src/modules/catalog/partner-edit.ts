import type { PartnerType } from "@/db/schema";
import { isCountryCode, MAX_PAYMENT_TERM_DAYS } from "./constants";
import { parseCoordinates } from "./coordinates";

const TYPE_BY_LABEL: Record<string, PartnerType> = {
  entreprise: "company",
  particulier: "individual",
};

export interface PartnerEditData {
  readonly name: string;
  readonly type: PartnerType;
  readonly isCustomer: boolean;
  readonly isSupplier: boolean;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly taxNumber: string | null;
  readonly paymentTermDays: number;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly active: boolean;
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

/** ART-001 + ART-009 — la fiche d'un tiers se corrige avec les mêmes bornes que sa création. */
export function validatePartnerEdit(raw: Record<string, unknown>): {
  data: PartnerEditData;
  errors: string[];
} {
  const errors: string[] = [];

  const name = text(raw.nom, "Nom", 120, errors);
  if (name === null) {
    errors.push("Le nom du tiers est obligatoire.");
  }

  const typeLabel = String(raw.type ?? "")
    .trim()
    .toLowerCase();
  const type = TYPE_BY_LABEL[typeLabel];
  if (!type) {
    errors.push("Le type du tiers est Entreprise ou Particulier.");
  }

  const isCustomer = flag(raw.client);
  const isSupplier = flag(raw.fournisseur);
  if (!isCustomer && !isSupplier) {
    errors.push("Un tiers est au moins client ou fournisseur.");
  }

  const email = text(raw.email, "E-mail", 160, errors);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    errors.push("L'e-mail est invalide.");
  }

  const phone = text(raw.telephone, "Téléphone", 30, errors);
  const addressLine = text(raw.adresse, "Adresse", 200, errors);
  const city = text(raw.ville, "Ville", 80, errors);
  const taxNumber = text(raw.numero_fiscal, "Numéro fiscal", 40, errors);

  const country = (text(raw.pays, "Pays", 2, errors) ?? "").toUpperCase();
  let countryCode: string | null = null;
  if (country !== "") {
    if (!/^[A-Z]{2}$/.test(country) || !isCountryCode(country)) {
      errors.push(`Le pays « ${country} » n'est pas un code ISO 3166-1 reconnu.`);
    } else {
      countryCode = country;
    }
  }

  const termRaw = String(raw.delai_paiement_jours ?? "0").trim();
  let paymentTermDays = 0;
  if (termRaw !== "") {
    if (!/^\d+$/.test(termRaw)) {
      errors.push("Le délai de paiement est un entier de jours.");
    } else {
      paymentTermDays = Number(termRaw);
      if (paymentTermDays > MAX_PAYMENT_TERM_DAYS) {
        errors.push(`Le délai de paiement dépasse ${MAX_PAYMENT_TERM_DAYS} jours.`);
      }
    }
  }

  const coordinates = parseCoordinates(raw);
  errors.push(...coordinates.errors);

  return {
    data: {
      name: name ?? "",
      type: type ?? "company",
      isCustomer,
      isSupplier,
      email,
      phone,
      addressLine,
      city,
      countryCode,
      taxNumber,
      paymentTermDays,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      active: raw.actif === undefined ? true : flag(raw.actif),
    },
    errors,
  };
}
