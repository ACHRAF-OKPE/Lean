import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }

  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, rawN, rawR, rawP, rawSalt, rawKey] = stored.split("$");
  if (algorithm !== "scrypt" || !rawN || !rawR || !rawP || !rawSalt || !rawKey) {
    return false;
  }

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1) {
    return false;
  }

  const salt = Buffer.from(rawSalt, "base64url");
  const expected = Buffer.from(rawKey, "base64url");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(MAX_MEMORY, 128 * N * r * 2),
  });

  return key.length === expected.length && timingSafeEqual(key, expected);
}
