import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INPUT_CLASS } from "./form-fields";

const SOURCE = readFileSync(join(process.cwd(), "src", "components", "form-fields.tsx"), "utf8");

describe("GEN-013 — le champ est une ligne soulignée", () => {
  it("pose une bordure basse et aucun cartouche", () => {
    expect(INPUT_CLASS).toContain("border-b");
    expect(INPUT_CLASS).toContain("border-0");
    expect(INPUT_CLASS).toContain("bg-transparent");
    expect(INPUT_CLASS).not.toMatch(/rounded-md|rounded-xl/);
  });

  it("fonce la ligne et rehausse le fond pendant la saisie", () => {
    expect(INPUT_CLASS).toContain("focus-visible:border-brand");
    expect(INPUT_CLASS).toContain("focus-visible:bg-brand-soft");
  });

  it("reste porté par la primitive commune, pas par les écrans", () => {
    expect(INPUT_CLASS).toContain("outline-none");
    expect(SOURCE).toContain("export const INPUT_CLASS");
  });

  it("garde le libellé et l'indexation clavier sur chaque contrôle", () => {
    expect(SOURCE).toContain("<label htmlFor={htmlFor}");
    expect(SOURCE).toMatch(/<label[\s\S]*type="checkbox"/);
  });
});
