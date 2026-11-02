import {
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

/** GEN-014 — le rail ne montre que ce que le membre peut lire ; les entrées plateforme restent ouvertes. */
export function visibleNavItems(levels: AccessLevels): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.module === undefined || atLeast(levels[item.module], "read"),
  );
}
