import { describe, expect, it } from "vitest";
import {
  HS_WORDING_TO_COMPLETE,
  deriveParentCode,
  hsCodeSuggestionText,
  hsLevel,
  hsUsageLabel,
  inheritanceFor,
  missingParentCodes,
  parentCandidates,
  resolveHsRef,
  suggestHsCodes,
  wordingTwins,
  type HsCodeOption,
  type HsParentFacts,
} from "./hs-codes";

function option(code: string, wording: string, tecRate: number | null = null): HsCodeOption {
  return { id: `id-${code}`, code, wording, tecRate };
}

describe("ART-017 — le niveau d'un code SH", () => {
  it("reconnaît les niveaux 6, 8 et 10 chiffres", () => {
    expect(hsLevel("090111")).toBe(6);
    expect(hsLevel("09011100")).toBe(8);
    expect(hsLevel("0901110000")).toBe(10);
  });

  it("refuse tout ce qui n'est pas 6, 8 ou 10 chiffres", () => {
    expect(hsLevel("09011")).toBeNull();
    expect(hsLevel("0901110")).toBeNull();
    expect(hsLevel("090111000")).toBeNull();
    expect(hsLevel("090111A")).toBeNull();
    expect(hsLevel("")).toBeNull();
  });
});

describe("ART-018 — la chaîne des parents", () => {
  it("liste les parents du plus proche au plus lointain", () => {
    expect(parentCandidates("0901110000")).toEqual(["09011100", "090111"]);
    expect(parentCandidates("09011100")).toEqual(["090111"]);
    expect(parentCandidates("090111")).toEqual([]);
  });

  it("retient le préfixe strict le plus proche comme parent par défaut", () => {
    expect(deriveParentCode("0901110000")).toBe("09011100");
    expect(deriveParentCode("09011100")).toBe("090111");
    expect(deriveParentCode("090111")).toBeNull();
  });

  it("ne propose que les parents absents, du plus lointain au plus proche", () => {
    expect(missingParentCodes("0901110000", new Set())).toEqual(["090111", "09011100"]);
    expect(missingParentCodes("0901110000", new Set(["090111"]))).toEqual(["09011100"]);
    expect(missingParentCodes("0901110000", new Set(["090111", "09011100"]))).toEqual([]);
  });

  it("hérite du parent le plus proche trouvé : unité complémentaire et taux TEC", () => {
    const parents = new Map<string, HsParentFacts>([
      ["090111", { supplementaryUnit: "KG", tecRate: 20 }],
    ]);

    expect(inheritanceFor("0901110000", parents)).toEqual({
      parentCode: "090111",
      supplementaryUnit: "KG",
      tecRate: 20,
    });
  });

  it("préfère le parent le plus proche quand les deux existent", () => {
    const parents = new Map<string, HsParentFacts>([
      ["090111", { supplementaryUnit: "KG", tecRate: 20 }],
      ["09011100", { supplementaryUnit: "L", tecRate: 5 }],
    ]);

    expect(inheritanceFor("0901110000", parents)).toEqual({
      parentCode: "09011100",
      supplementaryUnit: "L",
      tecRate: 5,
    });
  });

  it("n'hérite de rien quand aucun parent n'est présent", () => {
    expect(inheritanceFor("0901110000", new Map())).toEqual({
      parentCode: null,
      supplementaryUnit: null,
      tecRate: null,
    });
  });
});

describe("ART-017 — le champ guidé reconnaît un code ou un libellé", () => {
  const options = [
    option("090111", "Café non torréfié", 20),
    option("170199", "Sucre de canne", 5),
  ];

  it("retient le code exact", () => {
    expect(resolveHsRef("090111", options, true)).toEqual({
      kind: "match",
      option: options[0],
    });
  });

  it("retient le libellé exact, accents et casse ignorés", () => {
    expect(resolveHsRef("cafe non torrefie", options, true)).toEqual({
      kind: "match",
      option: options[0],
    });
  });

  it("propose la création d'un code inconnu quand le niveau le permet", () => {
    expect(resolveHsRef("0901110000", options, true)).toEqual({
      kind: "create",
      code: "0901110000",
    });
  });

  it("refuse la création d'un code inconnu sans le niveau requis", () => {
    expect(resolveHsRef("0901110000", options, false)).toEqual({
      kind: "refused",
      code: "0901110000",
    });
  });

  it("ne dit rien d'une saisie vide", () => {
    expect(resolveHsRef("   ", options, true)).toEqual({ kind: "empty" });
  });
});

describe("ART-017 — les suggestions du champ guidé", () => {
  const options = [
    option("090111", "Café non torréfié"),
    option("090121", "Café torréfié"),
    option("170199", "Sucre de canne"),
  ];

  it("cherche par code comme par libellé", () => {
    expect(suggestHsCodes("café", options).map((item) => item.code)).toEqual(["090111", "090121"]);
    expect(suggestHsCodes("0901", options).map((item) => item.code)).toEqual(["090111", "090121"]);
  });

  it("borne le nombre de propositions", () => {
    expect(suggestHsCodes("", options, 2)).toHaveLength(2);
  });
});

describe("ART-018 — l'alerte doublon de libellé", () => {
  it("rapproche deux libellés identiques à la casse et aux accents près", () => {
    const twins = wordingTwins("CAFE non torrefie", [option("090111", "Café non torréfié")]);
    expect(twins.map((item) => item.code)).toEqual(["090111"]);
  });

  it("ne signale rien pour un libellé vide", () => {
    expect(wordingTwins("  ", [option("090111", "Café")])).toEqual([]);
  });
});

describe("ART-017 / ART-019 — ce que le registre et le champ affichent", () => {
  it("compose le libellé d'un code sans jamais de tiret cadratin", () => {
    expect(hsCodeSuggestionText(option("090111", "Café non torréfié"))).toBe(
      "090111 · Café non torréfié",
    );
    expect(hsCodeSuggestionText(option("090111", ""))).toBe("090111");
    expect(hsCodeSuggestionText(option("090111", "Café"))).not.toContain("—");
  });

  it("dit l'usage d'un code en articles, lignes de douane et enfants", () => {
    expect(hsUsageLabel({ articles: 0, declarationLines: 0, children: 0 })).toBe("Libre");
    expect(hsUsageLabel({ articles: 2, declarationLines: 1, children: 3 })).toBe(
      "2 articles · 1 ligne de douane · 3 enfants",
    );
    expect(hsUsageLabel({ articles: 1, declarationLines: 0, children: 0 })).toBe("1 article");
  });

  it("nomme le libellé des parents créés automatiquement", () => {
    expect(HS_WORDING_TO_COMPLETE).toBe("À compléter");
  });
});
