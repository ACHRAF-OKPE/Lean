import { atLeast, type RequiredLevel } from "@/modules/identity/modules";

/** GEN-017 — les actions exécutables sur une sélection de tiers. */
export const PARTNER_BULK_ACTIONS = [
  "roles",
  "activer",
  "desactiver",
  "categories",
  "exporter",
  "supprimer",
] as const;

export type PartnerBulkAction = (typeof PARTNER_BULK_ACTIONS)[number];

export const PARTNER_BULK_ACTION_LABELS: Record<PartnerBulkAction, string> = {
  roles: "Ajouter un rôle",
  activer: "Réactiver",
  desactiver: "Désactiver",
  categories: "Remplacer les catégories",
  exporter: "Exporter en XLSX",
  supprimer: "Supprimer",
};

/** GEN-012 — la suppression et le paramétrage relèvent de la gestion, la modification de l'écriture, l'état de la lecture. */
export const PARTNER_BULK_LEVELS: Record<PartnerBulkAction, RequiredLevel> = {
  roles: "write",
  activer: "write",
  desactiver: "write",
  categories: "write",
  exporter: "read",
  supprimer: "manage",
};

export interface BulkPartnerLine {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly references: readonly string[];
}

export type BulkPlan =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * GEN-017 — ce que la sélection permet avant d'écrire : le niveau d'abord, puis chaque ligne qui
 * doit un refus lisible. Le lot s'applique intégralement ou pas du tout.
 */
export function planPartnerBulk(input: {
  action: PartnerBulkAction;
  lines: readonly BulkPartnerLine[];
  level: RequiredLevel | undefined;
  selectedIds: readonly string[];
}): BulkPlan {
  if (input.selectedIds.length === 0) {
    return { ok: false, errors: ["Aucun tiers sélectionné."] };
  }

  const label = PARTNER_BULK_ACTION_LABELS[input.action];
  if (!atLeast(input.level ?? "none", PARTNER_BULK_LEVELS[input.action])) {
    return {
      ok: false,
      errors: [`L'action « ${label} » demande un niveau de droit plus élevé sur le module Tiers.`],
    };
  }

  const selected = new Set(input.selectedIds);
  const errors: string[] = [];
  for (const line of input.lines) {
    if (!selected.has(line.id)) {
      continue;
    }
    if (input.action === "supprimer" && line.references.length > 0) {
      errors.push(
        `${line.code} · ${line.name} : rattaché à ${line.references.join(", ")}, la suppression est refusée.`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    ids: input.lines.filter((line) => selected.has(line.id)).map((line) => line.id),
  };
}

/** L'action est-elle proposée à ce niveau ? Les commandes hors niveau n'apparaissent pas à l'écran. */
export function isBulkActionAllowed(
  action: PartnerBulkAction,
  level: RequiredLevel | undefined,
): boolean {
  return atLeast(level ?? "none", PARTNER_BULK_LEVELS[action]);
}
