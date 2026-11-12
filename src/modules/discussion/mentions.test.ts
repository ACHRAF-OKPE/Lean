import { describe, expect, it } from "vitest";
import { detectMentionsFromText, getInitials, parseBodyWithMentions } from "./mentions";

describe("Mentions et taguage de personnes (COL-002)", () => {
  const members = [
    { userId: "11111111-1111-1111-1111-111111111111", name: "Awa Test" },
    { userId: "22222222-2222-2222-2222-222222222222", name: "Achraf Okpe" },
    { userId: "33333333-3333-3333-3333-333333333333", name: "Awa" },
  ];

  it("génère les initiales correctement", () => {
    expect(getInitials("Awa Test")).toBe("AT");
    expect(getInitials("Achraf")).toBe("AC");
    expect(getInitials("Jean Paul Sartre")).toBe("JS");
    expect(getInitials("")).toBe("?");
    expect(getInitials(null)).toBe("?");
  });

  it("détecte les personnes mentionnées dans le texte", () => {
    const text = "Bonjour @Awa Test, peux-tu valider avec @Achraf Okpe ?";
    const detected = detectMentionsFromText(text, members);
    expect(detected).toContain("11111111-1111-1111-1111-111111111111");
    expect(detected).toContain("22222222-2222-2222-2222-222222222222");
    expect(detected).not.toContain("33333333-3333-3333-3333-333333333333");
  });

  it("ne détecte rien s'il n'y a pas d'arobase", () => {
    expect(detectMentionsFromText("Message sans mention", members)).toHaveLength(0);
  });

  it("découpe le texte en segments avec les mentions isolées", () => {
    const segments = parseBodyWithMentions("Merci @Awa Test pour la validation.", [
      { userId: "11111111-1111-1111-1111-111111111111", name: "Awa Test" },
    ]);
    expect(segments).toEqual([
      { type: "text", value: "Merci " },
      { type: "mention", value: "Awa Test", userId: "11111111-1111-1111-1111-111111111111" },
      { type: "text", value: " pour la validation." },
    ]);
  });
});
