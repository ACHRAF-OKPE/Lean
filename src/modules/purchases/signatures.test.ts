import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant } from "@/test/purchases";
import { createPurchaseOrder, transitionPurchaseOrder } from "./queries";
import { savePurchaseSettings } from "./settings";
import { listTasksForEntity } from "@/modules/tasks/queries";
import {
  allPurchaseSignaturesConfirmed,
  confirmPurchaseSignature,
  listPurchaseSignatureSteps,
  uploadPurchaseSignature,
} from "./signatures";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("PUR-010 — circuit de signature séquentiel", () => {
  it("exige un dépôt et sa confirmation avant de débloquer le signataire suivant puis le fournisseur", async () => {
    const ids = await seedPurchasingTenant(db, "pur010-sequence");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: ids.userId, role: "owner" });
    const [secondSigner] = await db
      .insert(users)
      .values({ email: "signataire-deux@test.local", name: "Moussa Second", passwordHash: "hash" })
      .returning({ id: users.id });
    if (!secondSigner) throw new Error("Signataire de test absent.");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: secondSigner.id, role: "member" });

    await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: 0, signerUserIds: [ids.userId, secondSigner.id] },
    });
    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });
    const confirmed = await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "confirm",
    });
    expect(confirmed.signatureWorkflowStarted).toBe(true);
    expect(
      await allPurchaseSignaturesConfirmed(db, { tenantId: ids.tenantId, orderId: order.id }),
    ).toBe(false);

    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nSigned PO test"));
    await expect(
      uploadPurchaseSignature(db, {
        tenantId: ids.tenantId,
        orderId: order.id,
        actorUserId: secondSigner.id,
        fileName: "signe.pdf",
        mime: "application/pdf",
        data: pdf,
      }),
    ).rejects.toThrow(/Aucun dépôt n'est attendu/);
    await uploadPurchaseSignature(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: ids.userId,
      fileName: "po-signe-1.pdf",
      mime: "application/pdf",
      data: pdf,
    });
    let steps = await listPurchaseSignatureSteps(db, { tenantId: ids.tenantId, orderId: order.id });
    expect(steps.map((step) => step.status)).toEqual(["awaiting_confirmation", "awaiting_upload"]);
    expect(
      await allPurchaseSignaturesConfirmed(db, { tenantId: ids.tenantId, orderId: order.id }),
    ).toBe(false);
    await expect(
      confirmPurchaseSignature(db, {
        tenantId: ids.tenantId,
        orderId: order.id,
        actorUserId: secondSigner.id,
      }),
    ).rejects.toThrow(/signataire attendu/);

    const firstConfirmation = await confirmPurchaseSignature(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: ids.userId,
    });
    expect(firstConfirmation.complete).toBe(false);
    expect(firstConfirmation.nextSigner?.signerEmail).toBe("signataire-deux@test.local");
    await expect(
      confirmPurchaseSignature(db, {
        tenantId: ids.tenantId,
        orderId: order.id,
        actorUserId: secondSigner.id,
      }),
    ).rejects.toThrow(/Déposez d'abord/);
    await uploadPurchaseSignature(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: secondSigner.id,
      fileName: "po-signe-2.pdf",
      mime: "application/pdf",
      data: pdf,
    });
    const finalConfirmation = await confirmPurchaseSignature(db, {
      tenantId: ids.tenantId,
      orderId: order.id,
      actorUserId: secondSigner.id,
    });
    expect(finalConfirmation.complete).toBe(true);
    expect(finalConfirmation.nextSigner).toBeNull();
    expect(
      await allPurchaseSignaturesConfirmed(db, { tenantId: ids.tenantId, orderId: order.id }),
    ).toBe(true);

    steps = await listPurchaseSignatureSteps(db, { tenantId: ids.tenantId, orderId: order.id });
    expect(steps.map((step) => step.status)).toEqual(["confirmed", "confirmed"]);
    expect(steps.map((step) => step.confirmedAt).every(Boolean)).toBe(true);
  });

  it("rejette les PDF falsifiés ou dépassant la limite", async () => {
    const ids = await seedPurchasingTenant(db, "pur010-files");
    await db
      .insert(memberships)
      .values({ tenantId: ids.tenantId, userId: ids.userId, role: "owner" });
    await savePurchaseSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { defaultReceiptDelayDays: 0, signerUserIds: [ids.userId] },
    });
    const order = await createPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        supplierId: ids.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "request",
    });
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.id,
      action: "confirm",
    });

    for (const data of [new Uint8Array(Buffer.from("not-a-pdf-file")), new Uint8Array(1_048_577)]) {
      await expect(
        uploadPurchaseSignature(db, {
          tenantId: ids.tenantId,
          orderId: order.id,
          actorUserId: ids.userId,
          fileName: "fichier.pdf",
          mime: "application/pdf",
          data,
        }),
      ).rejects.toThrow(/PDF signé valide/);
    }
  });

  describe("PUR-012 — tâche de signature pour chaque signataire", () => {
    it("crée une tâche pour le premier signataire à la confirmation, puis pour le suivant après confirmation du premier", async () => {
      const ids = await seedPurchasingTenant(db, "pur012-tasks");
      await db
        .insert(memberships)
        .values({ tenantId: ids.tenantId, userId: ids.userId, role: "owner" });
      const [secondSigner] = await db
        .insert(users)
        .values({
          email: "signataire-deux-pur012@test.local",
          name: "Moussa Second",
          passwordHash: "hash",
        })
        .returning({ id: users.id });
      if (!secondSigner) throw new Error("Signataire de test absent.");
      await db
        .insert(memberships)
        .values({ tenantId: ids.tenantId, userId: secondSigner.id, role: "member" });

      await savePurchaseSettings(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { defaultReceiptDelayDays: 0, signerUserIds: [ids.userId, secondSigner.id] },
      });
      const order = await createPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: {
          supplierId: ids.supplierId,
          expectedReceiptDate: "",
          externalReference: "",
          notes: "",
          lines: [{ articleId: ids.productId, qty: "1", unitPriceXof: 1000 }],
        },
      });
      await transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: order.id,
        action: "request",
      });
      const confirmed = await transitionPurchaseOrder(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        orderId: order.id,
        action: "confirm",
      });
      expect(confirmed.signatureWorkflowStarted).toBe(true);

      // Une tâche existe pour le premier signataire (ids.userId)
      const stepsBefore = await listTasksForEntity(db, {
        tenantId: ids.tenantId,
        entityType: "purchase_order",
        entityId: order.id,
      });
      expect(stepsBefore.length).toBe(1);
      expect(stepsBefore[0]!.assigneeUserId).toBe(ids.userId);
      expect(stepsBefore[0]!.status).toBe("open");
      expect(stepsBefore[0]!.priority).toBe("high");
      expect(stepsBefore[0]!.title).toContain("Signer le bon de commande");

      const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nSigned PO test"));
      await uploadPurchaseSignature(db, {
        tenantId: ids.tenantId,
        orderId: order.id,
        actorUserId: ids.userId,
        fileName: "po-signe-1.pdf",
        mime: "application/pdf",
        data: pdf,
      });
      const firstConfirmation = await confirmPurchaseSignature(db, {
        tenantId: ids.tenantId,
        orderId: order.id,
        actorUserId: ids.userId,
      });
      expect(firstConfirmation.complete).toBe(false);

      // Une tâche a été créée pour le second signataire
      const stepsAfter = await listTasksForEntity(db, {
        tenantId: ids.tenantId,
        entityType: "purchase_order",
        entityId: order.id,
      });
      expect(stepsAfter.length).toBe(2);
      const secondTask = stepsAfter.find((task) => task.assigneeUserId === secondSigner.id);
      expect(secondTask).toBeDefined();
      expect(secondTask!.status).toBe("open");
      expect(secondTask!.priority).toBe("high");
    });
  });
});
