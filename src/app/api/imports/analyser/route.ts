import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import {
  isImportKind,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_MB,
} from "@/modules/catalog/constants";
import { CatalogError } from "@/modules/catalog/errors";
import { analyzeImport } from "@/modules/catalog/imports";
import { can } from "@/modules/identity/permissions";
import { parseWorkbook } from "@/modules/catalog/xlsx";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return jsonError("Session expirée. Reconnectez-vous.", 401);
  }
  if (!can(session.role, "data.write")) {
    return jsonError("Votre rôle ne permet pas de modifier les données.", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Requête illisible : renvoyez le fichier.", 400);
  }

  const kind = String(form.get("kind") ?? "");
  if (!isImportKind(kind)) {
    return jsonError("Type d'import inconnu.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError("Aucun fichier reçu.", 400);
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return jsonError(`Fichier trop volumineux : ${MAX_IMPORT_FILE_MB} Mo maximum.`, 413);
  }

  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    return jsonError("Fichier illisible : relancez le téléversement.", 400);
  }

  const fileName = file.name.split(/[\\/]/).pop()?.slice(0, 160) || "import.xlsx";

  try {
    const parsed = await parseWorkbook(kind, data);
    const result = await analyzeImport(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      kind,
      fileName,
      fileHash: parsed.fileHash,
      sheetName: parsed.sheetName,
      rows: parsed.rows,
      notes: parsed.notes,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof CatalogError) {
      return jsonError(error.message, 422);
    }
    console.error("Échec de l'analyse d'import", error);
    return jsonError("L'analyse a échoué. Réessayez ou vérifiez le fichier.", 500);
  }
}
