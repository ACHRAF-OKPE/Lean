import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import type { ImportKind } from "@/db/schema";
import { IMPORT_KIND_PATHS, IMPORT_TEMPLATE_PATHS } from "@/modules/catalog/constants";

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const CREATE_LABELS: Record<ImportKind, string> = {
  partners: "Créer un tiers",
  articles: "Créer un article",
  hs_codes: "Créer un code SH",
  purchase_lines: "Créer une commande",
  sales_lines: "Créer une commande client",
  tasks: "Créer une tâche",
};

const IMPORT_LABELS: Record<ImportKind, string> = {
  partners: "Importer des tiers",
  articles: "Importer des articles",
  hs_codes: "Importer la nomenclature",
  purchase_lines: "Importer des lignes de commande",
  sales_lines: "Importer des lignes de vente",
  tasks: "Importer des tâches",
};

export function CatalogActions({ kind }: { kind: ImportKind }) {
  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={`${IMPORT_KIND_PATHS[kind]}/nouveau`}
        aria-label={CREATE_LABELS[kind]}
        title={CREATE_LABELS[kind]}
        className={ACTION_LINK}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Link>
      <Link
        href={`${IMPORT_KIND_PATHS[kind]}/import`}
        aria-label={IMPORT_LABELS[kind]}
        title={IMPORT_LABELS[kind]}
        className={ACTION_LINK}
      >
        <Upload className="size-4" aria-hidden="true" />
      </Link>
      <a
        href={IMPORT_TEMPLATE_PATHS[kind]}
        aria-label="Télécharger le modèle XLSX"
        title="Télécharger le modèle XLSX"
        className={ACTION_LINK}
      >
        <Download className="size-4" aria-hidden="true" />
      </a>
    </div>
  );
}
