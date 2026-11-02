import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type Level, type ModuleKey } from "@/modules/identity/modules";
import { visibleNavItems } from "./nav-items";

function levels(overrides: Partial<Record<ModuleKey, Level>> = {}): Record<ModuleKey, Level> {
  const base = Object.fromEntries(MODULE_KEYS.map((key) => [key, "none"])) as Record<
    ModuleKey,
    Level
  >;
  return { ...base, ...overrides };
}

describe("GEN-014 — le rail de navigation", () => {
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
