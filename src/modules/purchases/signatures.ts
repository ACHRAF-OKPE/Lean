import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  memberships,
  purchaseOrderSignatures,
  purchaseOrders,
  purchaseSettings,
  users,
} from "@/db/schema";
import { PurchaseError } from "./errors";
import { createTaskForPurchaseOrder } from "@/modules/tasks/queries";

const MAX_SIGNED_PDF_BYTES = 1_048_576;
const PDF_MIME = "application/pdf";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PurchaseSignerNotice {
  readonly signatureId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly signerName: string;
  readonly signerEmail: string;
  readonly sequence: number;
}

export interface PurchaseSignatureStep {
  readonly id: string;
  readonly signerUserId: string;
  readonly signerName: string;
  readonly signerEmail: string;
  readonly sequence: number;
  readonly status: "awaiting_upload" | "awaiting_confirmation" | "confirmed";
  readonly fileName: string | null;
  readonly uploadedAt: Date | null;
  readonly confirmedAt: Date | null;
}

async function loadSteps(db: Database | Transaction, tenantId: string, orderId: string) {
  return db
    .select({
      id: purchaseOrderSignatures.id,
      signerUserId: purchaseOrderSignatures.signerUserId,
      signerName: users.name,
      signerEmail: users.email,
      sequence: purchaseOrderSignatures.sequence,
      status: purchaseOrderSignatures.status,
      fileName: purchaseOrderSignatures.fileName,
      uploadedAt: purchaseOrderSignatures.uploadedAt,
      confirmedAt: purchaseOrderSignatures.confirmedAt,
    })
    .from(purchaseOrderSignatures)
    .innerJoin(users, eq(users.id, purchaseOrderSignatures.signerUserId))
    .where(
      and(
        eq(purchaseOrderSignatures.tenantId, tenantId),
        eq(purchaseOrderSignatures.orderId, orderId),
      ),
    )
    .orderBy(asc(purchaseOrderSignatures.sequence));
}

export async function listPurchaseSignatureSteps(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<readonly PurchaseSignatureStep[]> {
  return loadSteps(db, input.tenantId, input.orderId);
}

export async function getCurrentPurchaseSigner(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<PurchaseSignerNotice | null> {
  const [order] = await db
    .select({ id: purchaseOrders.id, number: purchaseOrders.number })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
    .limit(1);
  if (!order?.number) return null;
  const [step] = await db
    .select({
      signatureId: purchaseOrderSignatures.id,
      signerName: users.name,
      signerEmail: users.email,
      sequence: purchaseOrderSignatures.sequence,
    })
    .from(purchaseOrderSignatures)
    .innerJoin(users, eq(users.id, purchaseOrderSignatures.signerUserId))
    .where(
      and(
        eq(purchaseOrderSignatures.tenantId, input.tenantId),
        eq(purchaseOrderSignatures.orderId, input.orderId),
        ne(purchaseOrderSignatures.status, "confirmed"),
      ),
    )
    .orderBy(asc(purchaseOrderSignatures.sequence))
    .limit(1);
  return step
    ? {
        signatureId: step.signatureId,
        orderId: order.id,
        orderNumber: order.number,
        signerName: step.signerName,
        signerEmail: step.signerEmail,
        sequence: step.sequence,
      }
    : null;
}

export async function markPurchaseSignerNotified(
  db: Database,
  input: { tenantId: string; signatureId: string; orderId: string; actorUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(purchaseOrderSignatures)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
          eq(purchaseOrderSignatures.id, input.signatureId),
          ne(purchaseOrderSignatures.status, "confirmed"),
        ),
      )
      .returning({ id: purchaseOrderSignatures.id });
    if (!updated) return;
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.signature.notify",
      entityType: "purchase_order",
      entityId: input.orderId,
      details: { signatureId: input.signatureId },
    });
  });
}

export async function initializePurchaseSignatureChain(
  tx: Transaction,
  input: { tenantId: string; orderId: string },
): Promise<boolean> {
  const [settings] = await tx
    .select({ signerUserIds: purchaseSettings.signerUserIds })
    .from(purchaseSettings)
    .where(eq(purchaseSettings.tenantId, input.tenantId))
    .limit(1);
  const signerUserIds = settings?.signerUserIds ?? [];
  if (signerUserIds.length === 0) return false;

  const activeMembers = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId)));
  const members = new Set(activeMembers.map((member) => member.userId));
  if (signerUserIds.some((userId) => !members.has(userId))) {
    throw new PurchaseError(
      "Le circuit de signature doit être actualisé : un signataire n'est plus membre de l'espace.",
    );
  }

  await tx.insert(purchaseOrderSignatures).values(
    signerUserIds.map((signerUserId, index) => ({
      tenantId: input.tenantId,
      orderId: input.orderId,
      signerUserId,
      sequence: index + 1,
      status: "awaiting_upload" as const,
    })),
  );
  return true;
}

export async function startPurchaseSignatureChain(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .limit(1)
      .for("update");
    if (!order || order.status !== "confirmed") {
      throw new PurchaseError("Le circuit de signature se lance uniquement sur un PO confirmé.");
    }
    const [existing] = await tx
      .select({ id: purchaseOrderSignatures.id })
      .from(purchaseOrderSignatures)
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
        ),
      )
      .limit(1);
    if (existing) throw new PurchaseError("Le circuit de signature de ce PO a déjà été créé.");
    const created = await initializePurchaseSignatureChain(tx, input);
    if (!created)
      throw new PurchaseError("Aucun signataire n'est défini dans les paramètres Achats.");
    await tx
      .update(purchaseOrders)
      .set({ signatureWorkflowRequired: true })
      .where(
        and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)),
      );
    return true;
  });
}

export async function uploadPurchaseSignature(
  db: Database,
  input: {
    tenantId: string;
    orderId: string;
    actorUserId: string;
    fileName: string;
    mime: string;
    data: Uint8Array;
  },
): Promise<void> {
  const fileName = input.fileName.trim();
  if (
    !fileName.toLowerCase().endsWith(".pdf") ||
    fileName.length > 200 ||
    /[/\\]/.test(fileName) ||
    input.mime !== PDF_MIME ||
    input.data.length < 8 ||
    input.data.length > MAX_SIGNED_PDF_BYTES ||
    Buffer.from(input.data.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    throw new PurchaseError("Déposez un fichier PDF signé valide de 1 Mio maximum.");
  }

  await db.transaction(async (tx) => {
    const [step] = await tx
      .select()
      .from(purchaseOrderSignatures)
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
          eq(purchaseOrderSignatures.signerUserId, input.actorUserId),
        ),
      )
      .for("update");
    const [current] = await tx
      .select({ id: purchaseOrderSignatures.id })
      .from(purchaseOrderSignatures)
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
          ne(purchaseOrderSignatures.status, "confirmed"),
        ),
      )
      .orderBy(asc(purchaseOrderSignatures.sequence))
      .limit(1);
    if (!step || step.id !== current?.id || step.status !== "awaiting_upload") {
      throw new PurchaseError("Aucun dépôt n'est attendu pour votre compte à cette étape.");
    }
    await tx
      .update(purchaseOrderSignatures)
      .set({
        status: "awaiting_confirmation",
        fileName,
        fileMime: PDF_MIME,
        fileSize: input.data.byteLength,
        fileData: input.data,
        uploadedAt: new Date(),
      })
      .where(eq(purchaseOrderSignatures.id, step.id));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.signature.upload",
      entityType: "purchase_order",
      entityId: input.orderId,
      details: { sequence: step.sequence, fileName, fileSize: input.data.byteLength },
    });
  });
}

export async function confirmPurchaseSignature(
  db: Database,
  input: { tenantId: string; orderId: string; actorUserId: string },
): Promise<{ complete: boolean; nextSigner: PurchaseSignerNotice | null }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseOrderSignatures)
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
          ne(purchaseOrderSignatures.status, "confirmed"),
        ),
      )
      .orderBy(asc(purchaseOrderSignatures.sequence))
      .limit(1)
      .for("update");
    if (!current || current.signerUserId !== input.actorUserId) {
      throw new PurchaseError("Vous n'êtes pas le signataire attendu de cette étape.");
    }
    if (current.status !== "awaiting_confirmation" || !current.fileData) {
      throw new PurchaseError(
        "Déposez d'abord le PO signé, puis confirmez ce dépôt après vérification.",
      );
    }
    await tx
      .update(purchaseOrderSignatures)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(purchaseOrderSignatures.id, current.id));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "purchase.signature.confirm",
      entityType: "purchase_order",
      entityId: input.orderId,
      details: { sequence: current.sequence, fileName: current.fileName },
    });
    const [order] = await tx
      .select({ id: purchaseOrders.id, number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
      .limit(1);
    const [next] = await tx
      .select({
        signatureId: purchaseOrderSignatures.id,
        signerUserId: purchaseOrderSignatures.signerUserId,
        signerName: users.name,
        signerEmail: users.email,
        sequence: purchaseOrderSignatures.sequence,
      })
      .from(purchaseOrderSignatures)
      .innerJoin(users, eq(users.id, purchaseOrderSignatures.signerUserId))
      .where(
        and(
          eq(purchaseOrderSignatures.tenantId, input.tenantId),
          eq(purchaseOrderSignatures.orderId, input.orderId),
          ne(purchaseOrderSignatures.status, "confirmed"),
        ),
      )
      .orderBy(asc(purchaseOrderSignatures.sequence))
      .limit(1);

    // PUR-012 — une tâche est créée pour le signataire suivant du circuit
    if (next) {
      await createTaskForPurchaseOrder(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        assigneeUserId: next.signerUserId,
        title: `Signer le bon de commande ${order?.number}`,
        description: `Circuit de signature, étape ${next.sequence} : déposez le PDF signé puis confirmez le dépôt pour le transmettre au signataire suivant.`,
        orderId: input.orderId,
        priority: "high",
      });
    }

    return {
      complete: !next,
      nextSigner:
        next && order?.number
          ? {
              signatureId: next.signatureId,
              orderId: order.id,
              orderNumber: order.number,
              signerName: next.signerName,
              signerEmail: next.signerEmail,
              sequence: next.sequence,
            }
          : null,
    };
  });
}

export async function getPurchaseSignatureFile(
  db: Database,
  input: { tenantId: string; orderId: string; signatureId: string },
): Promise<{ fileName: string; data: Uint8Array } | null> {
  const [row] = await db
    .select({
      fileName: purchaseOrderSignatures.fileName,
      fileData: purchaseOrderSignatures.fileData,
    })
    .from(purchaseOrderSignatures)
    .where(
      and(
        eq(purchaseOrderSignatures.tenantId, input.tenantId),
        eq(purchaseOrderSignatures.orderId, input.orderId),
        eq(purchaseOrderSignatures.id, input.signatureId),
      ),
    )
    .limit(1);
  return row?.fileName && row.fileData ? { fileName: row.fileName, data: row.fileData } : null;
}

export async function getLatestConfirmedPurchaseSignatureFile(
  db: Database,
  input: { tenantId: string; orderId: string; beforeSequence?: number },
): Promise<{ fileName: string; data: Uint8Array } | null> {
  const [row] = await db
    .select({
      fileName: purchaseOrderSignatures.fileName,
      fileData: purchaseOrderSignatures.fileData,
    })
    .from(purchaseOrderSignatures)
    .where(
      and(
        eq(purchaseOrderSignatures.tenantId, input.tenantId),
        eq(purchaseOrderSignatures.orderId, input.orderId),
        eq(purchaseOrderSignatures.status, "confirmed"),
        input.beforeSequence === undefined
          ? undefined
          : sql`${purchaseOrderSignatures.sequence} < ${input.beforeSequence}`,
      ),
    )
    .orderBy(desc(purchaseOrderSignatures.sequence))
    .limit(1);
  return row?.fileName && row.fileData ? { fileName: row.fileName, data: row.fileData } : null;
}

export async function allPurchaseSignaturesConfirmed(
  db: Database,
  input: { tenantId: string; orderId: string },
): Promise<boolean> {
  const steps = await loadSteps(db, input.tenantId, input.orderId);
  const [order] = await db
    .select({ signatureWorkflowRequired: purchaseOrders.signatureWorkflowRequired })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.tenantId, input.tenantId), eq(purchaseOrders.id, input.orderId)))
    .limit(1);
  if (!order) return false;
  if (steps.length === 0) {
    if (order.signatureWorkflowRequired) return false;
    const [settings] = await db
      .select({ signerUserIds: purchaseSettings.signerUserIds })
      .from(purchaseSettings)
      .where(eq(purchaseSettings.tenantId, input.tenantId))
      .limit(1);
    return (settings?.signerUserIds.length ?? 0) === 0;
  }
  return steps.every((step) => step.status === "confirmed");
}
