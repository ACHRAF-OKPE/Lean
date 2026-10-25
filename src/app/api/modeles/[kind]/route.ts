import { requirePermission } from "@/lib/auth/session";
import { resolveTemplateKind } from "@/modules/catalog/constants";
import { buildTemplate, templateFileName } from "@/modules/catalog/xlsx";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const kind = resolveTemplateKind(slug);
  if (!kind) {
    return new Response("Modèle inconnu.", { status: 404 });
  }

  await requirePermission("data.read");
  const bytes = await buildTemplate(kind);

  return new Response(new Blob([bytes]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${templateFileName(kind)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
