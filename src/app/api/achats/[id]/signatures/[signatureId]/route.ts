import { getDb } from "@/db/client";
import { canAccessModule, getSession } from "@/lib/auth/session";
import { getPurchaseSignatureFile } from "@/modules/purchases/signatures";
import { can } from "@/modules/identity/permissions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; signatureId: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (!can(session.role, "data.read") || !(await canAccessModule(session, "purchases", "read"))) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { id, signatureId } = await params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(signatureId)) {
    return new Response("Fichier absent", { status: 404 });
  }
  const file = await getPurchaseSignatureFile(getDb(), {
    tenantId: session.tenantId,
    orderId: id,
    signatureId,
  });
  if (!file) return new Response("Fichier absent", { status: 404 });
  const asciiName = file.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
