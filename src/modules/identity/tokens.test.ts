import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken, isSessionToken } from "./tokens";

describe("TEN-003 — jetons de session", () => {
  it("génère un jeton opaque et n'en stocke que l'empreinte", () => {
    const { token, tokenHash } = createSessionToken();

    expect(token).toHaveLength(43);
    expect(isSessionToken(token)).toBe(true);
    expect(tokenHash).toBe(hashSessionToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(token);
  });

  it("ne produit jamais deux fois le même jeton", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createSessionToken().token));

    expect(tokens.size).toBe(50);
  });

  it("rejette une valeur qui n'a pas la forme d'un jeton", () => {
    expect(isSessionToken("")).toBe(false);
    expect(isSessionToken("court")).toBe(false);
    expect(isSessionToken("a".repeat(43))).toBe(true);
    expect(isSessionToken("a".repeat(42) + "!")).toBe(false);
  });
});
