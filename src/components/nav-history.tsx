"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { breadcrumbFor, recordVisit, type TrailEntry } from "./nav-items";

const STORAGE_KEY = "lean.nav.history";
const HISTORY_EVENT = "lean:nav-history";

const EMPTY_HISTORY: readonly TrailEntry[] = [];

let cachedRaw: string | null = null;
let cachedHistory: readonly TrailEntry[] = EMPTY_HISTORY;

function parseHistory(raw: string | null): readonly TrailEntry[] {
  if (raw === null) return EMPTY_HISTORY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_HISTORY;
    return parsed.filter(
      (item): item is TrailEntry =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TrailEntry).href === "string" &&
        typeof (item as TrailEntry).label === "string",
    );
  } catch {
    return EMPTY_HISTORY;
  }
}

/** L'historique vit dans la session du navigateur ; on le lit comme une source externe à React. */
function readHistory(): readonly TrailEntry[] {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_HISTORY;
  }
  if (raw === cachedRaw) return cachedHistory;
  cachedRaw = raw;
  cachedHistory = parseHistory(raw);
  return cachedHistory;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(HISTORY_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(HISTORY_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * GEN-014 — historique des pages visitées, affiché horizontalement sous l'en-tête dans l'ordre du
 * parcours. Il ne survit pas à la fermeture de l'onglet et n'est pas partagé.
 */
export function NavHistoryTrail() {
  const pathname = usePathname();
  const history = useSyncExternalStore(subscribe, readHistory, () => EMPTY_HISTORY);

  useEffect(() => {
    const current = breadcrumbFor(pathname).at(-1);
    if (!current) return;

    const stored = readHistory();
    const next = recordVisit(stored, current);
    if (next === stored) return;

    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Stockage indisponible : l'historique reste celui de la session en mémoire.
      return;
    }
    window.dispatchEvent(new Event(HISTORY_EVENT));
  }, [pathname]);

  if (history.length < 2) return null;

  return (
    <nav
      aria-label="Historique de navigation"
      className="order-4 flex w-full items-center gap-1 overflow-x-auto border-t border-line pt-3 text-[11px]"
    >
      {history.map((entry, index) => {
        const current = index === history.length - 1;
        return (
          <span key={entry.href} className="flex shrink-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight className="size-3 text-muted/50" aria-hidden="true" />
            ) : null}
            {current ? (
              <span aria-current="page" className="font-medium text-brand-strong">
                {entry.label}
              </span>
            ) : (
              <Link
                href={entry.href}
                className="text-muted transition-colors hover:text-brand-strong"
              >
                {entry.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
