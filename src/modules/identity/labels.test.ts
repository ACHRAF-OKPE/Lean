import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_LABELS } from "./labels";

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") {
        continue;
      }
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("GEN-007 — écran d'audit en français", () => {
  it("donne un libellé français à chaque évènement d'audit écrit par le code", () => {
    const actions = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/action:\s*"([a-z_]+\.[a-z_.]+)"/g)) {
        actions.add(match[1] as string);
      }
    }

    expect(actions.size).toBeGreaterThan(60);
    const unlabeled = [...actions].filter((action) => !ACTION_LABELS[action]).sort();
    expect(unlabeled).toEqual([]);
  });

  it("écrit des libellés qui commencent par une majuscule", () => {
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      expect(label, action).toMatch(/^[A-ZÀ-Ÿ]/);
    }
  });
});
