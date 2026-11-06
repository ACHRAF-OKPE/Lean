import { MODULE_KEYS, type ModuleKey } from "@/modules/identity/modules";

/**
 * ORG-010 — un module porte son propre écran de paramétrage, à la manière d'Odoo. L'annuaire
 * ci-dessous est la source unique : le hub `/parametres` le lit, et chaque page livrée coche son
 * adresse. Un module sans adresse est annoncé comme à venir, jamais lié à une page absente.
 */
export interface ModuleSettingsEntry {
  /** Adresse de la page de paramétrage du module, ou `null` tant que l'écran n'est pas livré. */
  readonly href: string | null;
  /** Ce que l'écran de paramétrage du module laisse régler, en français. */
  readonly summary: string;
}

export const MODULE_SETTINGS: Record<ModuleKey, ModuleSettingsEntry> = {
  partners: {
    href: "/tiers/categories",
    summary: "Catégories de tiers, pour classer, filtrer et grouper le registre.",
  },
  articles: {
    href: "/articles/categories",
    summary: "Catégories d'articles, pour classer, filtrer et grouper le registre.",
  },
  nomenclature: {
    href: null,
    summary: "Longueur des codes SH et contrôle des parents.",
  },
  customs: {
    href: "/douane/referentiels",
    summary: "Bureaux douaniers, régimes ASYCUDA et taxes du tarif extérieur.",
  },
  purchases: {
    href: "/achats/parametres",
    summary: "Conditions d'achat, réception et valeurs proposées par défaut.",
  },
  tenders: {
    href: null,
    summary: "Validité des appels d'offres et règles de sélection des cotations.",
  },
  supply: {
    href: "/achats/approvisionnement",
    summary: "Politique d'approvisionnement, seuils et calcul des besoins.",
  },
  exchanges: {
    href: "/parametres/echanges",
    summary: "Compte d'envoi e-mail, modèles de demande et de confirmation, journal des envois.",
  },
  sales: {
    href: null,
    summary: "Conditions de vente, livraison et valeurs proposées par défaut.",
  },
  invoices: {
    href: null,
    summary: "Échéances de règlement, mentions et règles de facturation.",
  },
  stock: {
    href: "/stock/parametres",
    summary: "Magasin par défaut, seuil de réapprovisionnement et motif d'ajustement.",
  },
  tasks: {
    href: null,
    summary: "Priorités, échéances et assignation proposées par défaut.",
  },
  accounting: {
    href: "/comptabilite/parametres",
    summary: "Journal de paie, comptes de charges, cotisations et net.",
  },
  hr: {
    href: null,
    summary: "Organisation, temps de travail et types de congés.",
  },
  payroll: {
    href: "/paie/parametres",
    summary: "Jour de paiement et taux de cotisation salariale et patronale.",
  },
};

/** ORG-010 — l'adresse du paramétrage d'un module, ou `null` tant que l'écran n'est pas livré. */
export function settingsHref(module: ModuleKey): string | null {
  return MODULE_SETTINGS[module].href;
}

/** ORG-010 — un module figure dans l'annuaire dès que son écran de paramétrage est livré. */
export function hasSettings(module: ModuleKey): boolean {
  return MODULE_SETTINGS[module].href !== null;
}

/** ORG-010 — les modules dont l'écran de paramétrage est livré, dans l'ordre du catalogue. */
export function modulesWithSettings(): readonly ModuleKey[] {
  return MODULE_KEYS.filter(hasSettings);
}

/** ORG-010 — l'avancement de l'annuaire, pour l'afficher sans le recalculer à la main. */
export function settingsCoverage(): { readonly delivered: number; readonly total: number } {
  return { delivered: modulesWithSettings().length, total: MODULE_KEYS.length };
}
