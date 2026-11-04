import type { Role } from "./permissions";

export const LEVELS = ["none", "read", "write", "manage"] as const;

export type Level = (typeof LEVELS)[number];

export type RequiredLevel = Exclude<Level, "none">;

export const MODULE_KEYS = [
  "partners",
  "articles",
  "nomenclature",
  "customs",
  "purchases",
  "tenders",
  "supply",
  "exchanges",
  "sales",
  "invoices",
  "stock",
  "tasks",
  "accounting",
  "hr",
  "payroll",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

interface ModuleDescriptor {
  readonly label: string;
  readonly memberDefault: Level;
}

const CATALOG: Record<ModuleKey, ModuleDescriptor> = {
  partners: { label: "Tiers", memberDefault: "read" },
  articles: { label: "Articles", memberDefault: "read" },
  nomenclature: { label: "Nomenclature douanière", memberDefault: "read" },
  customs: { label: "Douane", memberDefault: "none" },
  purchases: { label: "Achats", memberDefault: "read" },
  tenders: { label: "Appels d'offres", memberDefault: "read" },
  supply: { label: "Besoins d'achat", memberDefault: "read" },
  exchanges: { label: "Échanges", memberDefault: "read" },
  sales: { label: "Ventes", memberDefault: "read" },
  invoices: { label: "Factures", memberDefault: "read" },
  stock: { label: "Stock", memberDefault: "read" },
  tasks: { label: "Tâches", memberDefault: "read" },
  accounting: { label: "Comptabilité", memberDefault: "none" },
  hr: { label: "Ressources humaines", memberDefault: "none" },
  payroll: { label: "Paie", memberDefault: "none" },
};

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2, manage: 3 };

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function moduleLabel(key: ModuleKey): string {
  return CATALOG[key].label;
}

export function modules(): readonly ModuleKey[] {
  return MODULE_KEYS;
}

export function defaultLevel(role: Role, key: ModuleKey): Level {
  if (role === "owner" || role === "admin") {
    return "manage";
  }
  return CATALOG[key].memberDefault;
}

export function effectiveLevel(role: Role, key: ModuleKey, grant: Level | null): Level {
  if (role === "owner") {
    return "manage";
  }
  return grant ?? defaultLevel(role, key);
}

export function atLeast(actual: Level, required: RequiredLevel): boolean {
  return RANK[actual] >= RANK[required];
}

export function resolveLevels(
  role: Role,
  grants: Readonly<Partial<Record<ModuleKey, Level>>>,
): Record<ModuleKey, Level> {
  const levels = {} as Record<ModuleKey, Level>;
  for (const key of MODULE_KEYS) {
    levels[key] = effectiveLevel(role, key, grants[key] ?? null);
  }
  return levels;
}

export function levelLabel(level: Level): string {
  if (level === "none") return "Aucun accès";
  if (level === "read") return "Lecture";
  if (level === "write") return "Écriture";
  return "Gestion";
}
