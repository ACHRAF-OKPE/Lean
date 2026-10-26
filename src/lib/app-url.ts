import { headers } from "next/headers";

export async function resolveAppUrl(): Promise<string> {
  const configured = process.env.LEAN_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host") ?? "localhost:3000";
  const forwardedProto = store.get("x-forwarded-proto");
  const local = host.startsWith("localhost") || host.startsWith("127.");
  return `${forwardedProto ?? (local ? "http" : "https")}://${host}`;
}
