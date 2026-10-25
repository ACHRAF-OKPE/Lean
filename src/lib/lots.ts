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
    status: "next",
  },
  {
    id: 2,
    title: "Tiers & articles",
    scope: "Nomenclature HS, import XLSX, template téléchargeable",
    status: "planned",
  },
  {
    id: 3,
    title: "Achat → réception → stock",
    scope: "Commandes fournisseur, réceptions, mouvements de stock",
    status: "planned",
  },
  {
    id: 4,
    title: "Vente → livraison → facture",
    scope: "Commandes client, livraisons, facturation",
    status: "planned",
  },
  {
    id: 5,
    title: "Douane",
    scope: "Régimes ASYCUDA, acquit-à-caution, apurement, TEDU",
    status: "planned",
  },
  {
    id: 6,
    title: "Comptabilité SYSCOHADA",
    scope: "Écritures, cut-off, rapprochements",
    status: "planned",
  },
  {
    id: 7,
    title: "Rapports & clôture",
    scope: "États de gestion, clôture, exports",
    status: "planned",
  },
];
