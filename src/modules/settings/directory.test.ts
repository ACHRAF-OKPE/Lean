import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/modules/identity/modules";
import {
  hasSettings,
  MODULE_SETTINGS,
  modulesWithSettings,
  settingsCoverage,
  settingsHref,
} from "./directory";

describe("ORG-010 — chaque module porte son propre écran de paramétrage", () => {
  it("décrit chaque module du catalogue par un résumé français", () => {
    expect(Object.keys(MODULE_SETTINGS).sort()).toEqual([...MODULE_KEYS].sort());
    for (const key of MODULE_KEYS) {
      expect(MODULE_SETTINGS[key].summary.trim().length).toBeGreaterThan(10);
    }
  });

  it("n'annonce que des adresses internes et uniques", () => {
    const hrefs = MODULE_KEYS.map((key) => MODULE_SETTINGS[key].href).filter(
      (href): href is string => href !== null,
    );
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(settingsHref("invoices")).toBe("/factures/parametres");
    expect(settingsHref("tasks")).toBe("/taches/parametres");
    expect(settingsHref("tenders")).toBe("/achats/appels-offres/parametres");
  });

  it("aligne hasSettings sur la présence d'une adresse", () => {
    for (const key of MODULE_KEYS) {
      expect(hasSettings(key)).toBe(settingsHref(key) !== null);
    }
    expect(settingsHref("payroll")).toBe("/paie/parametres");
  });

  it("lit l'annuaire dans l'ordre du catalogue et borne l'avancement", () => {
    const delivered = modulesWithSettings();
    expect(delivered).toEqual(MODULE_KEYS.filter((key) => hasSettings(key)));
    expect(settingsCoverage()).toEqual({
      delivered: delivered.length,
      total: MODULE_KEYS.length,
    });
    expect(settingsCoverage().delivered).toBeGreaterThan(0);
    expect(settingsCoverage().delivered).toBeLessThanOrEqual(MODULE_KEYS.length);
  });
});
