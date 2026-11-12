import { describe, expect, it } from "vitest";
import {
  formatTaggedBody,
  isMessageTag,
  parseMessageTag,
  MESSAGE_TAGS,
  MESSAGE_TAG_METAS,
} from "./tags";

describe("Tags de communication interne (COL-001)", () => {
  it("valide les tags autorisés et rejette les inconnus", () => {
    for (const tag of MESSAGE_TAGS) {
      expect(isMessageTag(tag)).toBe(true);
      expect(MESSAGE_TAG_METAS[tag].id).toBe(tag);
      expect(MESSAGE_TAG_METAS[tag].label).toBeTruthy();
      expect(MESSAGE_TAG_METAS[tag].prefix).toBeTruthy();
    }
    expect(isMessageTag("autre")).toBe(false);
    expect(isMessageTag(null)).toBe(false);
    expect(isMessageTag(123)).toBe(false);
  });

  it("parse correctement les préfixes de tag dans le corps du message", () => {
    expect(parseMessageTag("[DÉCISION] Nous confirmons la commande.")).toEqual({
      tag: "decision",
      cleanBody: "Nous confirmons la commande.",
      rawBody: "[DÉCISION] Nous confirmons la commande.",
    });

    expect(parseMessageTag("[QUESTION] Quel est le délai ?")).toEqual({
      tag: "question",
      cleanBody: "Quel est le délai ?",
      rawBody: "[QUESTION] Quel est le délai ?",
    });

    expect(parseMessageTag("[NOTE] Réunion à 10h.")).toEqual({
      tag: "note",
      cleanBody: "Réunion à 10h.",
      rawBody: "[NOTE] Réunion à 10h.",
    });

    expect(parseMessageTag("[URGENT] Bloquer le paiement immédiat")).toEqual({
      tag: "urgent",
      cleanBody: "Bloquer le paiement immédiat",
      rawBody: "[URGENT] Bloquer le paiement immédiat",
    });

    expect(parseMessageTag("Texte standard sans tag")).toEqual({
      tag: null,
      cleanBody: "Texte standard sans tag",
      rawBody: "Texte standard sans tag",
    });
  });

  it("formate un corps de message avec tag sans doubler le préfixe", () => {
    expect(formatTaggedBody("Valider le devis", "decision")).toBe("[DÉCISION] Valider le devis");
    expect(formatTaggedBody("[DÉCISION] Valider le devis", "decision")).toBe(
      "[DÉCISION] Valider le devis",
    );
    expect(formatTaggedBody("Note simple", null)).toBe("Note simple");
  });
});
