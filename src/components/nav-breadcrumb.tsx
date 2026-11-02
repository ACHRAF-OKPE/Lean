"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { breadcrumbFor } from "./nav-items";

/**
 * GEN-014 — fil d'Ariane vertical à gauche : la hiérarchie de la page courante, déduite de
 * l'adresse. Chaque niveau mène à son parent ; le niveau courant est marqué.
 */
export function NavBreadcrumb() {
  const pathname = usePathname();
  const trail = breadcrumbFor(pathname);

  return (
    <nav
      data-nav-breadcrumb=""
      aria-label="Fil d'Ariane"
      className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-panel px-4 py-5 lg:flex"
    >
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
        Fil d&apos;Ariane
      </p>
      <ol className="mt-3 space-y-0.5">
        {trail.map((entry, index) => {
          const current = index === trail.length - 1;
          return (
            <li key={entry.href}>
              <div className="flex items-center gap-1.5">
                {index > 0 ? (
                  <ChevronDown className="size-3 shrink-0 text-muted/50" aria-hidden="true" />
                ) : null}
                {current ? (
                  <span
                    aria-current="page"
                    className="min-w-0 truncate text-[11px] font-medium text-brand-strong"
                  >
                    {entry.label}
                  </span>
                ) : (
                  <Link
                    href={entry.href}
                    className="min-w-0 truncate text-[11px] text-muted transition-colors hover:text-brand-strong"
                  >
                    {entry.label}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
