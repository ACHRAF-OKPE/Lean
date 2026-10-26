import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ExchangeError } from "./errors";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function resolveKey(key?: string): Buffer {
  const raw = key ?? process.env.LEAN_SECRET_KEY;
  if (!raw) {
    throw new ExchangeError(
      "Chiffrement non configuré : la variable LEAN_SECRET_KEY est absente du serveur.",
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.byteLength !== KEY_BYTES) {
    throw new ExchangeError(
      "Chiffrement non configuré : LEAN_SECRET_KEY doit contenir 32 octets encodés en base64.",
    );
  }
  return decoded;
}

export function encryptSecret(plain: string, key?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(key), iv);
  cipher.setAAD(Buffer.from(VERSION));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string, key?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new ExchangeError("Mot de passe SMTP illisible : format de chiffrement inconnu.");
  }
  const [, ivPart, tagPart, dataPart] = parts;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      resolveKey(key),
      Buffer.from(ivPart!, "base64"),
    );
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(Buffer.from(tagPart!, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart!, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ExchangeError) {
      throw error;
    }
    throw new ExchangeError(
      "Mot de passe SMTP illisible : la clé de chiffrement a changé ou les données sont altérées.",
    );
  }
}
