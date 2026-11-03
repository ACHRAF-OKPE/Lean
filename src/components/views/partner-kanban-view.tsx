"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { FormErrors } from "@/components/form-fields";
import { movePartnerCategoryAction } from "@/lib/catalog/actions";
import { UNGROUPED_COLUMN, type KanbanItem } from "@/modules/catalog/kanban";

interface Column {
  readonly id: string | null;
  readonly title: string;
}

/**
 * ART-016 — le Kanban range les tiers par catégorie ; le glisser-déposer (API native HTML5) rattache
 * la carte à la colonne d'accueil. Déposée sur « Sans catégorie », la carte détache le tiers de toutes
 * ses catégories. La fiche reste la voie accessible pour le même geste.
 */
export function PartnerKanbanView({
  rows,
  categories,
  categoryIdsByPartner,
  canWrite,
}: {
  rows: readonly KanbanItem[];
  categories: readonly { readonly id: string; readonly title: string }[];
  categoryIdsByPartner: Readonly<Record<string, readonly string[]>>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const columns: readonly Column[] = [
    ...categories.map((category) => ({ id: category.id, title: category.title })),
    { id: null, title: UNGROUPED_COLUMN },
  ];

  function categoryIdsOf(partnerId: string): readonly string[] {
    if (partnerId in overrides) {
      const value = overrides[partnerId];
      return value ? [value] : [];
    }
    return categoryIdsByPartner[partnerId] ?? [];
  }

  function itemsIn(column: Column): readonly KanbanItem[] {
    return rows.filter((item) => {
      const ids = categoryIdsOf(item.id);
      return column.id === null ? ids.length === 0 : ids.includes(column.id);
    });
  }

  function drop(partnerId: string, target: Column) {
    setErrors([]);
    const previous = overrides[partnerId];
    setOverrides((current) => ({ ...current, [partnerId]: target.id }));
    startTransition(async () => {
      const result = await movePartnerCategoryAction({ partnerId, categoryId: target.id });
      if (!result.ok) {
        setOverrides((current) => {
          const next = { ...current };
          if (previous === undefined) {
            delete next[partnerId];
          } else {
            next[partnerId] = previous;
          }
          return next;
        });
        setErrors([result.error]);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {errors.length > 0 ? <FormErrors errors={errors} /> : null}

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-4">
          {columns.map((column) => {
            const columnItems = itemsIn(column);
            const key = column.id ?? "sans-categorie";
            return (
              <section
                key={key}
                aria-label={`Catégorie ${column.title}`}
                onDragOver={(event) => {
                  if (!canWrite) return;
                  event.preventDefault();
                  setHovered(key);
                }}
                onDragLeave={() => setHovered((current) => (current === key ? null : current))}
                onDrop={(event) => {
                  if (!canWrite) return;
                  event.preventDefault();
                  setHovered(null);
                  const partnerId = event.dataTransfer.getData("text/plain");
                  setDragging(null);
                  if (partnerId) drop(partnerId, column);
                }}
                className={`w-64 shrink-0 rounded-xl border bg-panel transition-colors ${
                  hovered === key ? "border-brand/40 bg-brand-soft/40" : "border-line"
                }`}
              >
                <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                  <h2 className="truncate text-[11px] font-medium">
                    {column.title}
                    {column.id === null ? (
                      <span className="ml-1.5 text-[10px] font-normal text-muted">à classer</span>
                    ) : null}
                  </h2>
                  <span className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                    {columnItems.length}
                  </span>
                </header>

                <ul className="space-y-2 p-2.5">
                  {columnItems.map((item) => (
                    <li
                      key={`${key}-${item.id}`}
                      draggable={canWrite && !pending}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", item.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(item.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={`rounded-lg border border-line bg-canvas px-3 py-2.5 ${
                        canWrite ? "cursor-grab active:cursor-grabbing" : ""
                      } ${dragging === item.id ? "opacity-40" : ""}`}
                    >
                      <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                        {item.code}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium">
                        <Link
                          href={`/tiers/${item.id}`}
                          className="transition-colors hover:text-brand"
                        >
                          {item.name}
                        </Link>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                        {item.isCustomer ? <span>Client</span> : null}
                        {item.isCustomer && item.isSupplier ? (
                          <span aria-hidden="true">·</span>
                        ) : null}
                        {item.isSupplier ? <span>Fournisseur</span> : null}
                        <span aria-hidden="true">·</span>
                        <span>
                          {[item.city, item.countryCode].filter(Boolean).join(" · ") || "—"}
                        </span>
                        {item.active ? null : <span className="text-copper">inactif</span>}
                      </p>
                    </li>
                  ))}
                </ul>

                {columnItems.length === 0 ? (
                  <p className="px-3 pb-3 text-[10px] text-muted">
                    {canWrite ? "Déposez une carte ici." : "Aucun tiers."}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>

      {pending ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted" role="status">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          Enregistrement du rattachement…
        </p>
      ) : null}
    </div>
  );
}
