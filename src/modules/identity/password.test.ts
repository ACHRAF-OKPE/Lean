import { describe, expect, it } from "vitest";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";

describe("TEN-003 — mots de passe", () => {
  it("stocke un hash scrypt salé, jamais le mot de passe en clair", async () => {
    const hash = await hashPassword("mot-de-passe-solide");

    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(hash).not.toContain("mot-de-passe-solide");
    expect(await verifyPassword("mot-de-passe-solide", hash)).toBe(true);
    expect(await verifyPassword("mot-de-passe-solide!", hash)).toBe(false);
  });

  it("tire un sel différent à chaque enregistrement", async () => {
    const first = await hashPassword("mot-de-passe-solide");
    const second = await hashPassword("mot-de-passe-solide");

    expect(first).not.toBe(second);
  });

  it("refuse un mot de passe plus court que la politique", async () => {
    const tooShort = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    await expect(hashPassword(tooShort)).rejects.toBeInstanceOf(RangeError);
  });

  it("refuse un hash malformé sans lever d'erreur", async () => {
    expect(await verifyPassword("mot-de-passe-solide", "")).toBe(false);
    expect(await verifyPassword("mot-de-passe-solide", "scrypt$32768$8$1$abc")).toBe(false);
    expect(await verifyPassword("mot-de-passe-solide", "bcrypt$10$abc$def")).toBe(false);
  });
});
