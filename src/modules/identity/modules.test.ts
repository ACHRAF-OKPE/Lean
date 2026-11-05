import { describe, expect, it } from "vitest";
import {
  actionVisibility,
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

  it("scelle la comptabilité, la douane, les RH et la paie pour un membre sans concession", () => {
    expect(defaultLevel("member", "accounting")).toBe("none");
    expect(defaultLevel("member", "customs")).toBe("none");
    expect(defaultLevel("member", "hr")).toBe("none");
    expect(defaultLevel("member", "payroll")).toBe("none");
  });

  it("donne au membre la lecture des autres modules", () => {
    for (const key of MODULE_KEYS) {
      if (key === "accounting" || key === "customs" || key === "hr" || key === "payroll") {
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
    expect(MODULE_KEYS).toContain("payroll");
    expect(isModuleKey("sales")).toBe(true);
    expect(isModuleKey("payroll")).toBe(true);
    expect(isModuleKey("inexistant")).toBe(false);
    expect(isModuleKey(undefined)).toBe(false);
    expect(isLevel("read")).toBe(true);
    expect(isLevel("rw")).toBe(false);
    expect(LEVELS).toEqual(["none", "read", "write", "manage"]);
  });
});

describe("PAY-002 — le module Paie rejoint le catalogue des droits", () => {
  it("compte quinze modules dont la paie", () => {
    expect(MODULE_KEYS).toHaveLength(15);
    expect(isModuleKey("payroll")).toBe(true);
    expect(moduleLabel("payroll")).toBe("Paie");
    expect(MODULE_KEYS).toContain("hr");
  });

  it("ouvre le module Paie par concession et le referme par le sceau", () => {
    expect(effectiveLevel("member", "payroll", null)).toBe("none");
    expect(effectiveLevel("member", "payroll", "read")).toBe("read");
    expect(effectiveLevel("member", "payroll", "write")).toBe("write");
    expect(effectiveLevel("member", "payroll", "manage")).toBe("manage");
    expect(effectiveLevel("member", "payroll", "none")).toBe("none");
    expect(effectiveLevel("owner", "payroll", "none")).toBe("manage");
    expect(atLeast(defaultLevel("admin", "payroll"), "manage")).toBe(true);
  });
});

describe("GEN-018 — un écran n'affiche que les actions que le niveau autorise", () => {
  it("n'ouvre la création et la modification d'un brouillon qu'à partir de l'écriture", () => {
    expect(actionVisibility("none").canDraft).toBe(false);
    expect(actionVisibility("read").canDraft).toBe(false);
    expect(actionVisibility("write").canDraft).toBe(true);
    expect(actionVisibility("manage").canDraft).toBe(true);
  });

  it("réserve les transitions, la suppression et le paramétrage à la gestion", () => {
    expect(actionVisibility("none").canManage).toBe(false);
    expect(actionVisibility("read").canManage).toBe(false);
    expect(actionVisibility("write").canManage).toBe(false);
    expect(actionVisibility("manage").canManage).toBe(true);
  });
});

describe("HR-001 — le module RH rejoint le catalogue des droits", () => {
  it("garde les ressources humaines dans le catalogue", () => {
    expect(isModuleKey("hr")).toBe(true);
    expect(moduleLabel("hr")).toBe("Ressources humaines");
    expect(MODULE_KEYS).toContain("payroll");
  });

  it("ouvre le module RH par concession et le referme par le sceau", () => {
    expect(effectiveLevel("member", "hr", null)).toBe("none");
    expect(effectiveLevel("member", "hr", "read")).toBe("read");
    expect(effectiveLevel("member", "hr", "write")).toBe("write");
    expect(effectiveLevel("member", "hr", "manage")).toBe("manage");
    expect(effectiveLevel("member", "hr", "none")).toBe("none");
    expect(effectiveLevel("owner", "hr", "none")).toBe("manage");
    expect(atLeast(defaultLevel("admin", "hr"), "manage")).toBe(true);
  });
});
