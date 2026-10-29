import type {
  CustomsApurementMode,
  CustomsBondStatus,
  CustomsDeclarationStatus,
  CustomsRegimeKind,
  CustomsTaxBase,
} from "@/db/schema";

export const CUSTOMS_DECLARATION_STATUSES = [
  "draft",
  "deposited",
  "liquidated",
  "cleared",
  "cancelled",
] as const;

export const CUSTOMS_DECLARATION_STATUS_LABELS: Record<CustomsDeclarationStatus, string> = {
  draft: "Brouillon",
  deposited: "Déposée",
  liquidated: "Liquidée",
  cleared: "Mainlevée",
  cancelled: "Annulée",
};

export const CUSTOMS_BOND_STATUS_LABELS: Record<CustomsBondStatus, string> = {
  open: "Ouvert",
  apured: "Apuré",
};

export const CUSTOMS_REGIME_KINDS = ["import", "export", "suspensive", "transit"] as const;

export const CUSTOMS_REGIME_KIND_LABELS: Record<CustomsRegimeKind, string> = {
  import: "Importation",
  export: "Exportation",
  suspensive: "Suspensif",
  transit: "Transit",
};

export const CUSTOMS_TAX_BASES = ["cif", "cif_plus_duty"] as const;

export const CUSTOMS_TAX_BASE_LABELS: Record<CustomsTaxBase, string> = {
  cif: "Valeur en douane (CIF)",
  cif_plus_duty: "Valeur en douane + droits",
};

export const TEC_RATES = [0, 5, 10, 20, 35] as const;

export const CUSTOMS_MAX_REFERENCE = 60;
export const CUSTOMS_MAX_DESIGNATION = 160;
export const CUSTOMS_MAX_GUARANTEE_REFERENCE = 120;
export const CUSTOMS_MAX_APUREMENT_REFERENCE = 120;
export const CUSTOMS_MAX_APUREMENT_ENTRY_REFERENCE = 120;
export const CUSTOMS_MAX_PAYMENT_REFERENCE = 120;
export const CUSTOMS_LIST_LIMIT = 200;

export const CUSTOMS_APUREMENT_MODES = ["production", "export", "destruction", "transfer"] as const;

export const CUSTOMS_APUREMENT_MODE_LABELS: Record<CustomsApurementMode, string> = {
  production: "Production",
  export: "Exportation",
  destruction: "Destruction",
  transfer: "Transfert",
};

export function isCustomsApurementMode(value: string): value is CustomsApurementMode {
  return (CUSTOMS_APUREMENT_MODES as readonly string[]).includes(value);
}

export function isTecRate(value: number): boolean {
  return (TEC_RATES as readonly number[]).includes(value);
}

export function isCustomsRegimeKind(value: string): value is CustomsRegimeKind {
  return (CUSTOMS_REGIME_KINDS as readonly string[]).includes(value);
}

export function isCustomsTaxBase(value: string): value is CustomsTaxBase {
  return (CUSTOMS_TAX_BASES as readonly string[]).includes(value);
}

export function isDeclarationStatus(value: string): value is CustomsDeclarationStatus {
  return (CUSTOMS_DECLARATION_STATUSES as readonly string[]).includes(value);
}
