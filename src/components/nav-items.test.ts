import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type Level, type ModuleKey } from "@/modules/identity/modules";
import { pageEntryFor, recordVisit, visibleNavItems, type TrailEntry } from "./nav-items";

function levels(overrides: Partial<Record<ModuleKey, Level>> = {}): Record<ModuleKey, Level> {
  const base = Object.fromEntries(MODULE_KEYS.map((key) => [key, "none"])) as Record<
    ModuleKey,
    Level
  >;
  return { ...base, ...overrides };
}

describe("GEN-014 — la barre de navigation", () => {
  it("ne montre que les entrées plateforme quand rien n'est concédé", () => {
    expect(visibleNavItems(levels()).map((item) => item.key)).toEqual(["home", "settings"]);
  });

  it("fait apparaître une section dès le niveau lecture", () => {
    const keys = visibleNavItems(levels({ partners: "read" })).map((item) => item.key);
    expect(keys).toContain("partners");
    expect(keys).not.toContain("articles");
  });

  it("garde la même section quel que soit le niveau au-delà de la lecture", () => {
    expect(visibleNavItems(levels({ hr: "manage" })).map((item) => item.key)).toContain("hr");
  });

  it("expose une adresse et un libellé français par entrée", () => {
    for (const item of visibleNavItems(levels({ sales: "read" }))) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.length).toBeGreaterThan(1);
    }
  });
});

describe("GEN-014 — la page courante", () => {
  it("nomme le cockpit « Accueil »", () => {
    expect(pageEntryFor("/")).toEqual({ label: "Accueil", href: "/" });
  });

  it("rend le libellé français et l'adresse du dernier segment", () => {
    expect(pageEntryFor("/tiers/categories")).toEqual({
      label: "Catégories",
      href: "/tiers/categories",
    });
  });

  it("garde le libellé brut d'un segment inconnu, comme un code de tiers", () => {
    expect(pageEntryFor("/tiers/CLI001")).toEqual({ label: "CLI001", href: "/tiers/CLI001" });
  });

  it("ignore une barre finale", () => {
    expect(pageEntryFor("/rh/temps/")).toEqual({ label: "Temps de travail", href: "/rh/temps/" });
  });
});

describe("GEN-014 — historique des pages visitées", () => {
  const page = (href: string): TrailEntry => ({ label: href, href });

  it("ajoute la page en fin de parcours", () => {
    expect(recordVisit([page("/a")], page("/b"))).toEqual([page("/a"), page("/b")]);
  });

  it("ne change rien en revenant sur la page courante", () => {
    const history = [page("/a"), page("/b")];
    expect(recordVisit(history, page("/b"))).toBe(history);
  });

  it("fait remonter une page déjà visitée plutôt que de la dupliquer", () => {
    expect(recordVisit([page("/a"), page("/b")], page("/a"))).toEqual([page("/b"), page("/a")]);
  });

  it("ne retient que les huit dernières pages", () => {
    const history = Array.from({ length: 8 }, (_, index) => page(`/${index}`));
    const next = recordVisit(history, page("/fin"));
    expect(next).toHaveLength(8);
    expect(next[0]?.href).toBe("/1");
    expect(next.at(-1)?.href).toBe("/fin");
  });
});
