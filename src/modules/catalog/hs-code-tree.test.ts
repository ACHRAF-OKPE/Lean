import { describe, expect, it } from "vitest";
import { groupHsCodesByChapter, hsChapter } from "./hs-code-tree";

describe("ART-020 — la vue hiérarchique de la nomenclature", () => {
  it("lit le chapitre dans les deux premiers chiffres", () => {
    expect(hsChapter("0901110000")).toBe("09");
    expect(hsChapter("170199")).toBe("17");
  });

  it("range le jeu en chapitres, positions de tête et lignes fines", () => {
    const rows = [
      { code: "170199" },
      { code: "0901110000" },
      { code: "090111" },
      { code: "09011100" },
    ];

    const chapters = groupHsCodesByChapter(rows);

    expect(chapters.map((chapter) => chapter.chapter)).toEqual(["09", "17"]);
    const position = chapters[0]?.groups[0];
    expect(position?.key).toBe("090111");
    expect(position?.heading?.code).toBe("090111");
    expect(position?.rows.map((row) => row.code)).toEqual(["09011100", "0901110000"]);
    expect(chapters[1]?.groups[0]?.heading?.code).toBe("170199");
  });

  it("garde une ligne orpheline sous son groupe sans tête", () => {
    const chapters = groupHsCodesByChapter([{ code: "0901110000" }]);

    expect(chapters[0]?.groups[0]?.key).toBe("090111");
    expect(chapters[0]?.groups[0]?.heading).toBeNull();
    expect(chapters[0]?.groups[0]?.rows.map((row) => row.code)).toEqual(["0901110000"]);
  });

  it("ne perd aucune ligne", () => {
    const rows = [{ code: "090111" }, { code: "09011100" }, { code: "0901110000" }];
    const chapters = groupHsCodesByChapter(rows);
    const seen = chapters.flatMap((chapter) =>
      chapter.groups.flatMap((group) => [
        ...(group.heading ? [group.heading.code] : []),
        ...group.rows.map((row) => row.code),
      ]),
    );

    expect(seen.sort()).toEqual(["090111", "09011100", "0901110000"]);
  });
});
