import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { getCompanyLogo } from "@/modules/settings/queries";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response("Non authentifié", { status: 401 });
  }

  const logo = await getCompanyLogo(getDb(), session.tenantId);
  if (!logo) {
    return new Response("Logo absent", { status: 404 });
  }

  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.data.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
