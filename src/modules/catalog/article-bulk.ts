import { atLeast, type RequiredLevel } from "@/modules/identity/modules";
import type { BulkPlan } from "./bulk";

/** GEN-017 — les actions exécutables sur une sélection d'articles. */
export const ARTICLE_BULK_ACTIONS = [
  "categories",
  "activer",
  "desactiver",
  "exporter",
  "supprimer",
] as const;

export type ArticleBulkAction = (typeof ARTICLE_BULK_ACTIONS)[number];

export const ARTICLE_BULK_ACTION_LABELS: Record<ArticleBulkAction, string> = {
  categories: "Remplacer les catégories",
  activer: "Réactiver",
  desactiver: "Désactiver",
  exporter: "Exporter en XLSX",
  supprimer: "Supprimer",
};

/** GEN-012 — la suppression et le paramétrage relèvent de la gestion, la modification de l'écriture, l'export de la lecture. */
export const ARTICLE_BULK_LEVELS: Record<ArticleBulkAction, RequiredLevel> = {
  categories: "write",
  activer: "write",
  desactiver: "write",
  exporter: "read",
  supprimer: "manage",
};

export interface BulkArticleLine {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly references: readonly string[];
}

/**
 * GEN-017 — ce que la sélection d'articles permet avant d'écrire : le niveau d'abord, puis chaque
 * ligne qui doit un refus lisible. Le lot s'applique intégralement ou pas du tout.
 */
export function planArticleBulk(input: {
  action: ArticleBulkAction;
  lines: readonly BulkArticleLine[];
  level: RequiredLevel | undefined;
  selectedIds: readonly string[];
}): BulkPlan {
  if (input.selectedIds.length === 0) {
    return { ok: false, errors: ["Aucun article sélectionné."] };
  }

  const label = ARTICLE_BULK_ACTION_LABELS[input.action];
  if (!atLeast(input.level ?? "none", ARTICLE_BULK_LEVELS[input.action])) {
    return {
      ok: false,
      errors: [
        `L'action « ${label} » demande un niveau de droit plus élevé sur le module Articles.`,
      ],
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
export function isArticleBulkActionAllowed(
  action: ArticleBulkAction,
  level: RequiredLevel | undefined,
): boolean {
  return atLeast(level ?? "none", ARTICLE_BULK_LEVELS[action]);
}
