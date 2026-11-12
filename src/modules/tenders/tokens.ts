import { createHash, randomBytes } from "node:crypto";
import { TENDER_TOKEN_BYTES } from "./rules";

export function hashTenderToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTenderToken(expiresAt: Date): {
  readonly token: string;
  readonly hash: string;
  readonly expiresAt: Date;
} {
  const token = randomBytes(TENDER_TOKEN_BYTES).toString("base64url");
  return { token, hash: hashTenderToken(token), expiresAt };
}
