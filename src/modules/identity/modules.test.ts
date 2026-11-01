import { describe, expect, it } from "vitest";
import {
  atLeast,
  defaultLevel,
  effectiveLevel,
  isLevel,
  isModuleKey,
  LEVELS,
  MODULE_KEYS,
  moduleLabel,
  resolveLevels,
} from "./modules";

describe("TEN-008 — niveaux d'accès par module", () => {
  it("laisse le propriétaire gérer tous les modules, quelle que soit la concession", () => {
    for (const key of MODULE_KEYS) {
      expect(effectiveLevel("owner", key, null)).toBe("manage");
      expect(effectiveLevel("owner", key, "none")).toBe("manage");
      expect(effectiveLevel("owner", key, "read")).toBe("manage");
    }
  });

  it("donne par défaut la gestion de tous les modules à l'administrateur", () => {
    for (const key of MODULE_KEYS) {
      expect(defaultLevel("admin", key)).toBe("manage");
    }
  });

  it("scelle la comptabilité et la douane pour un membre sans concession", () => {
    expect(defaultLevel("member", "accounting")).toBe("none");
    expect(defaultLevel("member", "customs")).toBe("none");
  });

  it("donne au membre la lecture des autres modules", () => {
    for (const key of MODULE_KEYS) {
      if (key === "accounting" || key === "customs") {
        continue;
      }
      expect(defaultLevel("member", key)).toBe("read");
    }
  });

  it("fait primer la concession explicite sur le défaut du rôle", () => {
    expect(effectiveLevel("member", "accounting", "write")).toBe("write");
    expect(effectiveLevel("member", "accounting", "manage")).toBe("manage");
    expect(effectiveLevel("member", "sales", "none")).toBe("none");
    expect(effectiveLevel("admin", "sales", "read")).toBe("read");
  });

  it("ordonne les niveaux : gestion inclut écriture, écriture inclut lecture", () => {
    expect(atLeast("manage", "read")).toBe(true);
    expect(atLeast("manage", "write")).toBe(true);
    expect(atLeast("manage", "manage")).toBe(true);
    expect(atLeast("write", "manage")).toBe(false);
    expect(atLeast("write", "read")).toBe(true);
    expect(atLeast("write", "write")).toBe(true);
    expect(atLeast("read", "write")).toBe(false);
    expect(atLeast("read", "read")).toBe(true);
    expect(atLeast("none", "read")).toBe(false);
  });

  it("résout la grille complète d'un utilisateur d'un seul coup", () => {
    const levels = resolveLevels("member", { accounting: "write", stock: "none" });
    expect(Object.keys(levels)).toHaveLength(MODULE_KEYS.length);
    expect(levels.accounting).toBe("write");
    expect(levels.stock).toBe("none");
    expect(levels.sales).toBe("read");
  });

  it("écrit des libellés français et uniques pour chaque module", () => {
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
    for (const key of MODULE_KEYS) {
      expect(moduleLabel(key).length).toBeGreaterThan(1);
    }
    expect(moduleLabel("accounting")).toBe("Comptabilité");
    expect(moduleLabel("purchases")).toBe("Achats");
  });

  it("ne reconnaît ni module ni niveau inconnu", () => {
    expect(MODULE_KEYS).not.toContain("payroll");
    expect(isModuleKey("sales")).toBe(true);
    expect(isModuleKey("payroll")).toBe(false);
    expect(isModuleKey(undefined)).toBe(false);
    expect(isLevel("read")).toBe(true);
    expect(isLevel("rw")).toBe(false);
    expect(LEVELS).toEqual(["none", "read", "write", "manage"]);
  });
});
