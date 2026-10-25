import type { Role } from "./permissions";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  member: "Membre",
};

export const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Connexion",
  "auth.logout": "Déconnexion",
  "tenant.switch": "Changement d'espace",
  "identity.bootstrap": "Création du propriétaire",
  "catalog.partner.create": "Création d'un tiers",
  "catalog.article.create": "Création d'un article",
  "catalog.hs_code.create": "Création d'un code SH",
  "catalog.import.apply": "Import appliqué",
  "purchase.order.create": "Création d'une commande fournisseur",
  "purchase.order.request": "Demande de commande",
  "purchase.order.confirm": "Confirmation de commande",
  "purchase.order.close": "Clôture de commande",
  "purchase.order.cancel": "Annulation de commande",
  "purchase.reception.create": "Réception de commande",
  "purchase.reception.cancel": "Annulation de réception",
};
