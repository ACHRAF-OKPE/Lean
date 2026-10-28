export type LotStatus = "done" | "next" | "planned";

export interface Lot {
  readonly id: number;
  readonly title: string;
  readonly scope: string;
  readonly status: LotStatus;
}

export const LOTS: readonly Lot[] = [
  {
    id: 0,
    title: "Socle technique",
    scope: "Scaffold, CI, conventions, registre de règles",
    status: "done",
  },
  {
    id: 1,
    title: "Socle applicatif",
    scope: "Authentification, multi-tenant, permissions, audit",
    status: "done",
  },
  {
    id: 2,
    title: "Tiers & articles",
    scope: "Nomenclature HS, import XLSX, template téléchargeable",
    status: "done",
  },
  {
    id: 3,
    title: "Achat → réception → stock",
    scope: "Commandes fournisseur, réceptions, mouvements de stock",
    status: "done",
  },
  {
    id: 4,
    title: "Vente → livraison → facture",
    scope: "Commandes client, livraisons, facturation, encours",
    status: "done",
  },
  {
    id: 5,
    title: "Socle ERP",
    scope: "Paramètres entreprise, contacts, échanges, collaboration et tâches",
    status: "done",
  },
  {
    id: 6,
    title: "Douane",
    scope: "Régimes ASYCUDA, acquit-à-caution, apurement, TEDU",
    status: "done",
  },
  {
    id: 7,
    title: "Comptabilité SYSCOHADA",
    scope: "Écritures, cut-off, rapprochements",
    status: "next",
  },
  {
    id: 8,
    title: "Rapports & clôture",
    scope: "États de gestion, clôture, exports",
    status: "planned",
  },
];
