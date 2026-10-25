import { createHash, randomBytes } from "node:crypto";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionToken {
  readonly token: string;
  readonly tokenHash: string;
}

export function createSessionToken(): SessionToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
