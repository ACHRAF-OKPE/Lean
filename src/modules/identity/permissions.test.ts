import { describe, expect, it } from "vitest";
import {
  can,
  isRole,
  PERMISSIONS,
  permissionsFor,
  ROLES,
  selectDefaultMembership,
} from "./permissions";

describe("TEN-002 — rôles et permissions", () => {
  it("accorde toutes les permissions au propriétaire", () => {
    expect(permissionsFor("owner")).toEqual(PERMISSIONS);
    for (const permission of PERMISSIONS) {
      expect(can("owner", permission)).toBe(true);
    }
  });

  it("réserve la gestion du tenant au propriétaire", () => {
    expect(can("owner", "tenant.manage")).toBe(true);
    expect(can("admin", "tenant.manage")).toBe(false);
    expect(can("member", "tenant.manage")).toBe(false);
  });

  it("donne à l'administrateur l'audit, les membres et les paramètres, pas au membre", () => {
    expect(can("admin", "audit.read")).toBe(true);
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("admin", "settings.manage")).toBe(true);
    expect(can("member", "audit.read")).toBe(false);
    expect(can("member", "members.manage")).toBe(false);
    expect(can("member", "settings.manage")).toBe(false);
    expect(can("member", "members.read")).toBe(false);
  });

  it("autorise tous les rôles à lire et écrire les données métier", () => {
    for (const role of ROLES) {
      expect(can(role, "data.read")).toBe(true);
      expect(can(role, "data.write")).toBe(true);
    }
  });

  it("ne reconnaît que les trois rôles prévus", () => {
    expect(ROLES).toEqual(["owner", "admin", "member"]);
    expect(isRole("owner")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe("TEN-001 — sélection de l'espace par défaut", () => {
  it("privilégie le rôle le plus fort, puis la membership la plus ancienne", () => {
    const member = { role: "member" as const, createdAt: new Date("2026-01-01") };
    const admin = { role: "admin" as const, createdAt: new Date("2026-02-01") };
    const owner = { role: "owner" as const, createdAt: new Date("2026-03-01") };

    expect(selectDefaultMembership([member, admin, owner])).toBe(owner);
    expect(selectDefaultMembership([admin, owner, member])).toBe(owner);
    expect(selectDefaultMembership([])).toBeUndefined();
  });
});
