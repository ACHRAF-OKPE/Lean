import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { getSupplierReplyAttachment } from "@/modules/exchange/reply-queries";
import { can } from "@/modules/identity/permissions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return new Response("Non authentifié", { status: 401 });
  }
  if (!can(session.role, "data.read")) {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return new Response("Pièce jointe absente", { status: 404 });
  }

  const attachment = await getSupplierReplyAttachment(getDb(), {
    tenantId: session.tenantId,
    replyId: id,
  });
  if (!attachment) {
    return new Response("Pièce jointe absente", { status: 404 });
  }

  const asciiName = attachment.name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(attachment.name);

  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mime,
      "Content-Length": String(attachment.data.byteLength),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
