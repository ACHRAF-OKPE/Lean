import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImportKind } from "@/db/schema";
import { MODULE_BY_IMPORT_KIND } from "@/modules/catalog/constants";
import { isModuleKey, MODULE_KEYS, type ModuleKey } from "./modules";

const APP_DIR = join(process.cwd(), "src", "app");

/** Préfixe d'URL → module visé ; le préfixe le plus long gagne, comme la navigation. */
const MODULE_BY_ROUTE_DIR: readonly [string, ModuleKey][] = [
  ["achats/appels-offres", "tenders"],
  ["achats/approvisionnement", "supply"],
  ["achats/besoins", "supply"],
  ["achats", "purchases"],
  ["api/rapports/[kind]", "accounting"],
  ["articles", "articles"],
  ["comptabilite", "accounting"],
  ["douane", "customs"],
  ["echanges", "exchanges"],
  ["factures", "invoices"],
  ["nomenclature", "nomenclature"],
  ["rh", "hr"],
  ["stock", "stock"],
  ["taches", "tasks"],
  ["tiers", "partners"],
  ["ventes", "sales"],
];

/** Routes hors module : plateforme, portail fournisseur par jeton, ou garde calculée dynamiquement. */
const PLATFORM_ROUTES: readonly string[] = [
  "",
  "api/entreprise/logo",
  "api/imports/analyser",
  "api/modeles/[kind]",
  "acces-refuse",
  "api/echanges/reponses/[id]/piece-jointe",
  "audit",
  "connexion",
  "cotations/[token]",
  "equipe",
  "imports/[batchId]",
  "notifications",
  "parametres",
  "parametres/echanges",
  "parametres/echanges/modeles/nouveau",
  "parametres/echanges/modeles/[id]",
  "repondre/[token]",
];

function routeFiles(dir: string, prefix = ""): { rel: string; file: string }[] {
  const found: { rel: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routeFiles(path, prefix === "" ? entry : `${prefix}/${entry}`));
      continue;
    }
    if (/^(page|route)\.tsx?$/.test(entry)) {
      found.push({ rel: prefix, file: path });
    }
  }
  return found;
}

function moduleOfRoute(rel: string): ModuleKey | null {
  const match = MODULE_BY_ROUTE_DIR.filter(
    ([dir]) => rel === dir || rel.startsWith(`${dir}/`),
  ).sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : null;
}

const ROUTES = routeFiles(APP_DIR).map((route) => ({
  ...route,
  source: readFileSync(route.file, "utf8"),
}));

describe("TEN-013 — toute route d'affaires est gardée par son module", () => {
  it("liste des routes non vides", () => {
    expect(ROUTES.length).toBeGreaterThan(60);
  });

  it("garde chaque route d'un module avec requireModule de ce module", () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      const expected = moduleOfRoute(route.rel);
      if (!expected) {
        continue;
      }
      const used = [...route.source.matchAll(/requireModule\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
      if (used.length === 0) {
        const importKind = /kind="([a-z_]+)"/.exec(route.source)?.[1];
        if (importKind) {
          used.push(MODULE_BY_IMPORT_KIND[importKind as ImportKind]);
        }
      }
      if (used.length === 0 || used.some((key) => key !== expected)) {
        offenders.push(`${route.rel} → ${used.join(", ") || "aucun garde module"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ne laisse aucune route sans garde explicite", () => {
    const ungated = ROUTES.filter((route) => {
      if (moduleOfRoute(route.rel) || PLATFORM_ROUTES.includes(route.rel)) {
        return false;
      }
      return !/requireModule\(|requirePermission\(|requireSession\(|getSession\(/.test(
        route.source,
      );
    }).map((route) => route.rel);

    expect(ungated).toEqual([]);
  });

  it("rattache chaque route à son module ou à la liste des routes plateforme", () => {
    const orphan = ROUTES.filter(
      (route) => !moduleOfRoute(route.rel) && !PLATFORM_ROUTES.includes(route.rel),
    ).map((route) => route.rel);

    expect(orphan).toEqual([]);
  });

  it("couvre les quatorze modules du catalogue par au moins une route", () => {
    const covered = new Set<ModuleKey>();
    for (const route of ROUTES) {
      for (const match of route.source.matchAll(/requireModule\(\s*"([a-z_]+)"/g)) {
        if (isModuleKey(match[1] as string)) {
          covered.add(match[1] as ModuleKey);
        }
      }
    }
    expect(MODULE_KEYS.every((key) => covered.has(key))).toBe(true);
    expect([...covered].sort()).toEqual([...MODULE_KEYS].sort());
  });

  it("bannit les gardes globales de données sur les routes d'affaires", () => {
    const global = ROUTES.filter(
      (route) =>
        moduleOfRoute(route.rel) && /requirePermission\("data\.(read|write)"\)/.test(route.source),
    ).map((route) => route.rel);

    expect(global).toEqual([]);
  });

  it("garde l'import sur le module de sa cible, de l'écran jusqu'à l'application", () => {
    const screens: [string, string][] = [
      ["src/components/import-section.tsx", `requireModule(MODULE_BY_IMPORT_KIND[kind], "write")`],
      [
        "src/app/api/imports/analyser/route.ts",
        `canAccessModule(session, MODULE_BY_IMPORT_KIND[kind], "write")`,
      ],
      ["src/modules/catalog/imports.ts", "MODULE_BY_IMPORT_KIND[batch.kind]"],
      ["src/lib/catalog/actions.ts", `await requireModule(moduleKey, "write")`],
    ];
    for (const [rel, needle] of screens) {
      expect(readFileSync(join(process.cwd(), rel), "utf8"), rel).toContain(needle);
    }
  });
});
