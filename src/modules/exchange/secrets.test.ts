import { describe, expect, it } from "vitest";
import { ExchangeError } from "./errors";
import { decryptSecret, encryptSecret } from "./secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("ORG-006 — chiffrement du mot de passe SMTP", () => {
  it("ORG-006 chiffre sans exposer le secret et déchiffre à l'identique", () => {
    const plain = "mot-de-passe-très-secret";
    const ciphertext = encryptSecret(plain, KEY);

    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(ciphertext).not.toContain(plain);
    expect(ciphertext.split(".")).toHaveLength(4);
    expect(decryptSecret(ciphertext, KEY)).toBe(plain);
  });

  it("ORG-006 produit un chiffré différent à chaque appel", () => {
    const first = encryptSecret("secret", KEY);
    const second = encryptSecret("secret", KEY);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, KEY)).toBe("secret");
    expect(decryptSecret(second, KEY)).toBe("secret");
  });

  it("ORG-006 refuse une autre clé et un chiffré altéré", () => {
    const ciphertext = encryptSecret("secret", KEY);
    expect(() => decryptSecret(ciphertext, OTHER_KEY)).toThrow(ExchangeError);

    const parts = ciphertext.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("altéré").toString("base64")].join(
      ".",
    );
    expect(() => decryptSecret(tampered, KEY)).toThrow(/illisible/);
    expect(() => decryptSecret("v2.a.b.c", KEY)).toThrow(/format/);
  });

  it("ORG-006 exige une clé de 32 octets encodée en base64", () => {
    expect(() => encryptSecret("secret", Buffer.alloc(16, 1).toString("base64"))).toThrow(
      /32 octets/,
    );
    expect(() => encryptSecret("secret", "pas-du-base64")).toThrow(/32 octets/);
    expect(() => encryptSecret("secret", "")).toThrow(/LEAN_SECRET_KEY/);
  });
});
