import { getDb } from "@/db/client";
import { canAccessModule, getSession } from "@/lib/auth/session";
import { getPurchaseOrderSignaturePdf } from "@/modules/exchange/queries";
import { can } from "@/modules/identity/permissions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (!can(session.role, "data.read") || !(await canAccessModule(session, "purchases", "read"))) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response("PO absent", { status: 404 });
  try {
    const pdf = await getPurchaseOrderSignaturePdf(getDb(), {
      tenantId: session.tenantId,
      orderId: id,
    });
    const asciiName = pdf.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(pdf.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("PDF indisponible", { status: 404 });
  }
}
