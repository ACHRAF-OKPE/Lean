import {
  Banknote,
  Barcode,
  BookOpen,
  FileSignature,
  Landmark,
  LayoutDashboard,
  ListTodo,
  Mail,
  Package,
  PackageSearch,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { atLeast, type Level, type ModuleKey } from "@/modules/identity/modules";

export type AccessLevels = Record<ModuleKey, Level>;

export type ActiveSection =
  | "home"
  | "partners"
  | "articles"
  | "nomenclature"
  | "customs"
  | "purchases"
  | "tenders"
  | "supply"
  | "exchanges"
  | "sales"
  | "invoices"
  | "stock"
  | "tasks"
  | "accounting"
  | "hr"
  | "payroll"
  | "team"
  | "settings"
  | "notifications"
  | "audit";

export interface NavItem {
  readonly key: ActiveSection;
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly module?: ModuleKey;
}

/** Une entrée sans `module` relève de la plateforme ; une entrée module n'apparaît qu'à partir du niveau `read`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", href: "/", label: "Poste de pilotage", icon: LayoutDashboard },
  { key: "partners", href: "/tiers", label: "Tiers", icon: Users, module: "partners" },
  { key: "articles", href: "/articles", label: "Articles", icon: Package, module: "articles" },
  {
    key: "nomenclature",
    href: "/nomenclature",
    label: "Nomenclature douanière",
    icon: Barcode,
    module: "nomenclature",
  },
  { key: "customs", href: "/douane", label: "Douane", icon: Landmark, module: "customs" },
  { key: "purchases", href: "/achats", label: "Achats", icon: ShoppingCart, module: "purchases" },
  {
    key: "tenders",
    href: "/achats/appels-offres",
    label: "Appels d'offres",
    icon: FileSignature,
    module: "tenders",
  },
  {
    key: "supply",
    href: "/achats/besoins",
    label: "Besoins",
    icon: PackageSearch,
    module: "supply",
  },
  { key: "exchanges", href: "/echanges", label: "Échanges", icon: Mail, module: "exchanges" },
  { key: "sales", href: "/ventes", label: "Ventes", icon: ShoppingBag, module: "sales" },
  { key: "invoices", href: "/factures", label: "Factures", icon: ReceiptText, module: "invoices" },
  { key: "stock", href: "/stock", label: "Stock", icon: Warehouse, module: "stock" },
  { key: "tasks", href: "/taches", label: "Tâches", icon: ListTodo, module: "tasks" },
  {
    key: "accounting",
    href: "/comptabilite",
    label: "Comptabilité",
    icon: BookOpen,
    module: "accounting",
  },
  { key: "hr", href: "/rh", label: "Ressources humaines", icon: UserCog, module: "hr" },
  { key: "payroll", href: "/paie", label: "Paie", icon: Banknote, module: "payroll" },
  { key: "settings", href: "/parametres", label: "Paramètres", icon: Settings },
];

export const TEAM_NAV_ITEM: NavItem = {
  key: "team",
  href: "/equipe",
  label: "Équipe et droits",
  icon: ShieldCheck,
};

export const AUDIT_NAV_ITEM: NavItem = {
  key: "audit",
  href: "/audit",
  label: "Journal d'audit",
  icon: ScrollText,
};

/** GEN-014 — la barre ne montre que ce que le membre peut lire ; les entrées plateforme restent ouvertes. */
export function visibleNavItems(levels: AccessLevels): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.module === undefined || atLeast(levels[item.module], "read"),
  );
}

/** GEN-014 — un pas de navigation : le libellé français et l'adresse à rejoindre. */
export interface TrailEntry {
  readonly label: string;
  readonly href: string;
}

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  tiers: "Tiers",
  articles: "Articles",
  nomenclature: "Nomenclature douanière",
  douane: "Douane",
  achats: "Achats",
  "appels-offres": "Appels d'offres",
  besoins: "Besoins",
  approvisionnement: "Approvisionnement",
  echanges: "Échanges",
  ventes: "Ventes",
  factures: "Factures",
  stock: "Stock",
  magasins: "Magasins",
  transferts: "Transferts",
  ajustements: "Ajustements",
  registre: "Registre",
  taches: "Tâches",
  comptabilite: "Comptabilité",
  rh: "Ressources humaines",
  paie: "Paie",
  rubriques: "Rubriques",
  parametres: "Paramètres",
  equipe: "Équipe et droits",
  audit: "Journal d'audit",
  notifications: "Notifications",
  temps: "Temps de travail",
  feries: "Jours fériés",
  calendriers: "Calendriers",
  pointages: "Pointages",
  journaux: "Journaux",
  "grand-livre": "Grand livre",
  balance: "Balance",
  lettrage: "Lettrage",
  rapprochement: "Rapprochement",
  engagements: "Engagements",
  exercices: "Exercices",
  resultat: "Résultat",
  comptes: "Comptes",
  categories: "Catégories",
  contacts: "Contacts",
  nouveau: "Nouveau",
  nouvelle: "Nouvelle",
  modifier: "Modifier",
  envoyer: "Envoyer",
};

/**
 * GEN-014 — la page courante se déduit de l'adresse, sans requête : le dernier segment nommé prend
 * son libellé français, un segment inconnu garde son libellé brut — le code d'un tiers, par exemple
 * — et le cockpit s'appelle « Accueil ».
 */
export function pageEntryFor(pathname: string): TrailEntry {
  const last = pathname
    .split("/")
    .filter((segment) => segment !== "")
    .at(-1);
  if (last === undefined) return { label: "Accueil", href: "/" };
  return { label: SEGMENT_LABELS[last] ?? last, href: pathname };
}

/** GEN-014 — l'historique ne retient que les huit dernières pages. */
export const HISTORY_LIMIT = 8;

/**
 * GEN-014 — l'historique garde l'ordre du parcours, la plus récente en fin. Une page déjà visitée
 * remonte en fin plutôt que d'être dupliquée ; revenir sur la page courante ne change rien.
 */
export function recordVisit(
  history: readonly TrailEntry[],
  entry: TrailEntry,
  limit: number = HISTORY_LIMIT,
): readonly TrailEntry[] {
  if (history.at(-1)?.href === entry.href) return history;
  const others = history.filter((item) => item.href !== entry.href);
  return [...others, entry].slice(-limit);
}
