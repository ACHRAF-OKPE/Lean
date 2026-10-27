import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, emailAccounts } from "@/db/schema";
import { createPurchaseOrder, transitionPurchaseOrder } from "@/modules/purchases/queries";
import { updateCompanySettings } from "@/modules/settings/queries";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedExchangeTenant, type ExchangeTenant } from "@/test/exchange";
import { seedPurchasingTenant } from "@/test/purchases";
import type { MailAccountConfig, OutgoingMail, TransportFactory } from "./mailer";
import {
  createExchangeTemplate,
  getEmailAccount,
  getEmailAccountConfig,
  getExchangeMessage,
  getExchangeSendContext,
  listExchangeMessages,
  listExchangeRecipients,
  listExchangeTemplates,
  resolveExchangeTemplate,
  resendExchangeMessage,
  saveEmailAccount,
  sendPurchaseExchange,
  testEmailAccountConnection,
  updateExchangeTemplate,
} from "./queries";
import { decryptSecret } from "./secrets";
import { BUILTIN_TEMPLATES } from "./templates";
import type { EmailAccountData, ExchangeTemplateData } from "./validation";
import { validateExchangeTemplate } from "./validation";

process.env.LEAN_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");

const PASSWORD = "secret-smtp-42";

interface Recorder {
  readonly factory: TransportFactory;
  readonly sent: OutgoingMail[];
  readonly verified: MailAccountConfig[];
  fail: Error | null;
}

function recorder(fail: Error | null = null): Recorder {
  const state: Recorder = {
    sent: [],
    verified: [],
    fail,
    factory: (config) => ({
      async verify() {
        state.verified.push(config);
        if (state.fail) {
          throw state.fail;
        }
      },
      async send(message) {
        if (state.fail) {
          throw state.fail;
        }
        state.sent.push(message);
        return { messageId: `<${state.sent.length}@lean.test>` };
      },
    }),
  };
  return state;
}

function accountData(patch: Partial<EmailAccountData> = {}): EmailAccountData {
  return {
    name: "SMTP transactionnel",
    host: "smtp.lean.test",
    port: 587,
    security: "starttls",
    username: "achats@lean.test",
    fromName: "Lean Achats",
    fromAddress: "achats@lean.test",
    replyTo: null,
    active: true,
    passwordAction: "set",
    password: PASSWORD,
    ...patch,
  };
}

function templateData(patch: Partial<ExchangeTemplateData> = {}): ExchangeTemplateData {
  return {
    name: "Modèle test",
    type: "purchase_request",
    subject: "Demande {{order.number}}",
    body: "Bonjour {{supplier.contact}},\n\n{{order.lines}}",
    isDefault: true,
    active: true,
    ...patch,
  };
}

async function validTemplate(
  db: Database,
  tenant: ExchangeTenant,
  patch: Partial<ExchangeTemplateData> = {},
): Promise<{ id: string }> {
  const validation = validateExchangeTemplate(templateData(patch));
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(" "));
  }
  return createExchangeTemplate(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    data: validation.data,
  });
}

async function setup(db: Database, label: string): Promise<ExchangeTenant> {
  return seedExchangeTenant(db, label);
}

async function send(
  db: Database,
  tenant: ExchangeTenant,
  orderId: string,
  transport: Recorder,
  overrides: Partial<{
    type: "purchase_request" | "purchase_confirmation";
    templateId: string | null;
    recipient: string;
    subject: string;
    body: string;
  }> = {},
) {
  return sendPurchaseExchange(
    db,
    {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      senderName: "Awa Koné",
      orderId,
      type: overrides.type ?? "purchase_request",
      templateId: overrides.templateId ?? null,
      recipient: overrides.recipient ?? "mariam@sahel.test",
      recipientName: "Mariam Traoré",
      subject: overrides.subject ?? "",
      body: overrides.body ?? "",
      appUrl: "https://lean.test",
    },
    transport.factory,
  );
}

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

describe("ORG-006 — compte d'envoi", () => {
  it("ORG-006 chiffre le mot de passe, le conserve et ne le relit jamais", async () => {
    const tenant = await setup(db, "org-006-save");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });

    const summary = await getEmailAccount(db, tenant.tenantId);
    expect(summary?.hasPassword).toBe(true);
    expect(summary).not.toHaveProperty("password");
    expect(summary).not.toHaveProperty("passwordCiphertext");

    const [row] = await db
      .select({ ciphertext: emailAccounts.passwordCiphertext })
      .from(emailAccounts)
      .where(eq(emailAccounts.tenantId, tenant.tenantId));
    expect(row?.ciphertext).toBeTruthy();
    expect(row?.ciphertext).not.toContain(PASSWORD);
    expect(decryptSecret(row!.ciphertext!)).toBe(PASSWORD);

    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData({ passwordAction: "keep", password: null, name: "Compte renommé" }),
    });
    const [kept] = await db
      .select({ ciphertext: emailAccounts.passwordCiphertext })
      .from(emailAccounts)
      .where(eq(emailAccounts.tenantId, tenant.tenantId));
    expect(kept?.ciphertext).toBe(row?.ciphertext);

    const config = await getEmailAccountConfig(db, tenant.tenantId);
    expect(config?.config.password).toBe(PASSWORD);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "exchange.account.save"),
        ),
      );
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it("ORG-006 refuse de retirer le mot de passe d'un compte identifié", async () => {
    const tenant = await setup(db, "org-006-clear");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    await expect(
      saveEmailAccount(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        data: accountData({ passwordAction: "clear", password: null }),
      }),
    ).rejects.toThrow(/obligatoire/);
  });

  it("ORG-006 teste la connexion sans envoyer de message ni journaliser de secret", async () => {
    const tenant = await setup(db, "org-006-test");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const transport = recorder();
    const result = await testEmailAccountConnection(
      db,
      { tenantId: tenant.tenantId, actorUserId: tenant.userId },
      transport.factory,
    );
    expect(result).toEqual({ host: "smtp.lean.test", port: 587 });
    expect(transport.verified).toHaveLength(1);
    expect(transport.verified[0]?.password).toBe(PASSWORD);
    expect(transport.sent).toHaveLength(0);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "exchange.account.test"),
        ),
      );
    expect((event?.details as { status?: string }).status).toBe("sent");
    expect(JSON.stringify(event?.details)).not.toContain(PASSWORD);
  });

  it("ORG-006 restitue un échec de test sans fuite du mot de passe", async () => {
    const tenant = await setup(db, "org-006-test-fail");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const transport = recorder(new Error(`Invalid login ${PASSWORD}`));
    await expect(
      testEmailAccountConnection(
        db,
        { tenantId: tenant.tenantId, actorUserId: tenant.userId },
        transport.factory,
      ),
    ).rejects.toThrow(/\*\*\*/);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "exchange.account.test"),
        ),
      );
    expect((event?.details as { status?: string }).status).toBe("failed");
    expect(JSON.stringify(event?.details)).not.toContain(PASSWORD);
  });

  it("ORG-006 oriente vers un mot de passe d'application quand les identifiants sont refusés", async () => {
    const tenant = await setup(db, "org-006-test-fail-hint");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const transport = recorder(
      new Error("Invalid login: 535-5.7.8 Username and Password not accepted"),
    );
    await expect(
      testEmailAccountConnection(
        db,
        { tenantId: tenant.tenantId, actorUserId: tenant.userId },
        transport.factory,
      ),
    ).rejects.toThrow(/mot de passe d'application/);
  });

  it("ORG-006 isole les comptes par espace de travail", async () => {
    const first = await setup(db, "org-006-tenant-a");
    const second = await setup(db, "org-006-tenant-b");
    await saveEmailAccount(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      data: accountData(),
    });
    expect(await getEmailAccount(db, second.tenantId)).toBeNull();
    await saveEmailAccount(db, {
      tenantId: second.tenantId,
      actorUserId: second.userId,
      data: accountData({ host: "smtp.autre.test" }),
    });
    expect((await getEmailAccount(db, second.tenantId))?.host).toBe("smtp.autre.test");
  });
});

describe("ORG-007 — modèles d'échange", () => {
  it("ORG-007 tient un seul modèle par défaut actif par type", async () => {
    const tenant = await setup(db, "org-007-default");
    const first = await validTemplate(db, tenant, { name: "Premier" });
    const second = await validTemplate(db, tenant, { name: "Second" });

    const templates = await listExchangeTemplates(db, tenant.tenantId, "purchase_request");
    const byId = new Map(templates.map((template) => [template.id, template]));
    expect(byId.get(first.id)?.isDefault).toBe(false);
    expect(byId.get(second.id)?.isDefault).toBe(true);

    const resolved = await resolveExchangeTemplate(db, tenant.tenantId, "purchase_request");
    expect(resolved.id).toBe(second.id);
    expect(resolved.builtin).toBe(false);
  });

  it("ORG-007 refuse un nom déjà pris", async () => {
    const tenant = await setup(db, "org-007-duplicate");
    await validTemplate(db, tenant, { name: "Double" });
    await expect(validTemplate(db, tenant, { name: "Double" })).rejects.toThrow(/déjà/);
  });

  it("ORG-007 retombe sur le modèle intégré sans défaut actif", async () => {
    const tenant = await setup(db, "org-007-builtin");
    const template = await validTemplate(db, tenant, { name: "Éphémère" });
    await updateExchangeTemplate(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      templateId: template.id,
      data: templateData({ name: "Éphémère", isDefault: false, active: false }),
    });

    const resolved = await resolveExchangeTemplate(db, tenant.tenantId, "purchase_request");
    expect(resolved.builtin).toBe(true);
    expect(resolved.id).toBeNull();
    expect(resolved.name).toBe(BUILTIN_TEMPLATES.purchase_request.name);
  });

  it("ORG-007 isole les modèles et l'unicité par espace", async () => {
    const first = await setup(db, "org-007-tenant-a");
    const second = await setup(db, "org-007-tenant-b");
    const template = await validTemplate(db, first, { name: "Partagé de nom" });
    await validTemplate(db, second, { name: "Partagé de nom" });

    expect(await listExchangeTemplates(db, second.tenantId)).toHaveLength(1);
    await expect(
      resolveExchangeTemplate(db, second.tenantId, "purchase_request", template.id),
    ).rejects.toThrow(/introuvable/);
  });
});

describe("ORG-008 — envoi et journal", () => {
  it("ORG-008 exige le bon statut de commande selon le type", async () => {
    const tenant = await setup(db, "org-008-status");
    const transport = recorder();
    await expect(
      send(db, tenant, tenant.requestedOrderId, transport, { type: "purchase_confirmation" }),
    ).rejects.toThrow(/Statut actuel : requested/);
    await expect(
      send(db, tenant, tenant.confirmedOrderId, transport, { type: "purchase_request" }),
    ).rejects.toThrow(/Statut actuel : confirmed/);
    expect(transport.sent).toHaveLength(0);
  });

  it("ORG-008 exige un compte actif, une raison sociale et un destinataire valide", async () => {
    const tenant = await setup(db, "org-008-prereq");
    const transport = recorder();
    await expect(send(db, tenant, tenant.requestedOrderId, transport)).rejects.toThrow(
      /Compte d'envoi absent ou inactif/,
    );

    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData({ active: false }),
    });
    await expect(send(db, tenant, tenant.requestedOrderId, transport)).rejects.toThrow(
      /Compte d'envoi absent ou inactif/,
    );

    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData({ active: true, passwordAction: "keep", password: null }),
    });
    await expect(
      send(db, tenant, tenant.requestedOrderId, transport, { recipient: "invalide" }),
    ).rejects.toThrow(/Destinataire/);
  });

  it("ORG-008 exige une raison sociale avant d'émettre un document", async () => {
    const tenant = await seedPurchasingTenant(db, "org-008-no-company-send");
    const order = await createPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: {
        supplierId: tenant.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: tenant.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId: order.id,
      action: "request",
    });
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    await expect(
      sendPurchaseExchange(
        db,
        {
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          senderName: "Awa Koné",
          orderId: order.id,
          type: "purchase_request",
          templateId: null,
          recipient: "contact@sahel.test",
          recipientName: null,
          subject: "Sujet",
          body: "Corps",
          appUrl: "https://lean.test",
        },
        recorder().factory,
      ),
    ).rejects.toThrow(/raison sociale/);
  });

  it("ORG-008 journalise un envoi réussi avec sujet rendu et PDF joint", async () => {
    const tenant = await setup(db, "org-008-send");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const transport = recorder();

    const result = await send(db, tenant, tenant.requestedOrderId, transport);
    expect(result.recipient).toBe("mariam@sahel.test");
    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0]!;
    expect(mail.toName).toBe("Mariam Traoré");
    expect(mail.subject).toContain("Lean SARL");
    expect(mail.text).toContain("Mariam Traoré");
    expect(mail.text).toContain("Café vert");
    expect(mail.html).toContain("<table");
    expect(mail.attachments).toHaveLength(1);
    expect(new TextDecoder().decode(mail.attachments[0]!.content.slice(0, 5))).toBe("%PDF-");

    const message = await getExchangeMessage(db, tenant.tenantId, result.messageId);
    expect(message?.status).toBe("sent");
    expect(message?.sentAt).not.toBeNull();
    expect(message?.errorMessage).toBeNull();
    expect(message?.templateName).toBe(BUILTIN_TEMPLATES.purchase_request.name);
    expect(message?.attachmentName).toMatch(/\.pdf$/);
    expect(message?.providerMessageId).toBe("<1@lean.test>");
    expect(message?.bodyText).toContain("Café vert");
    expect(message?.bodyHtml).toContain("<table");

    const audit = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.tenantId),
          eq(auditEvents.action, "exchange.message.send"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect((audit[0]?.details as { status?: string }).status).toBe("sent");
  });

  it("ORG-008 utilise le modèle personnalisé par défaut", async () => {
    const tenant = await setup(db, "org-008-template");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const template = await validTemplate(db, tenant, {
      name: "Demande maison",
      type: "purchase_confirmation",
      subject: "Prix {{order.number}}",
      body: "Bonjour {{supplier.contact}}, merci de chiffrer {{order.line_count}} ligne(s).",
    });
    const transport = recorder();
    const result = await send(db, tenant, tenant.confirmedOrderId, transport, {
      type: "purchase_confirmation",
    });
    expect(transport.sent[0]?.subject).toBe("Prix CMD-2026-0001");
    expect(transport.sent[0]?.text).toContain("2 ligne(s)");

    const message = await getExchangeMessage(db, tenant.tenantId, result.messageId);
    expect(message?.templateName).toBe("Demande maison");

    await expect(
      send(db, tenant, tenant.requestedOrderId, transport, { templateId: tenant.productId }),
    ).rejects.toThrow(/Modèle introuvable/);
    expect(template.id).toBeTruthy();
  });

  it("ORG-008 journalise un échec, le restitue et permet un renvoi relié", async () => {
    const tenant = await setup(db, "org-008-fail");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const failing = recorder(new Error(`SMTP refusé pour ${PASSWORD}`));
    await expect(send(db, tenant, tenant.requestedOrderId, failing)).rejects.toThrow(
      /Envoi refusé/,
    );

    const messages = await listExchangeMessages(db, {
      tenantId: tenant.tenantId,
      orderId: tenant.requestedOrderId,
    });
    expect(messages).toHaveLength(1);
    const failed = messages[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.sentAt).toBeNull();
    expect(failed.errorMessage).toContain("***");
    expect(failed.errorMessage).not.toContain(PASSWORD);

    const fixed = recorder();
    const resent = await resendExchangeMessage(
      db,
      {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        senderName: "Awa Koné",
        messageId: failed.id,
        appUrl: "https://lean.test",
      },
      fixed.factory,
    );
    expect(resent.messageId).not.toBe(failed.id);
    const detail = await getExchangeMessage(db, tenant.tenantId, resent.messageId);
    expect(detail?.status).toBe("sent");
    expect(detail?.resentFromId).toBe(failed.id);

    const all = await listExchangeMessages(db, {
      tenantId: tenant.tenantId,
      orderId: tenant.requestedOrderId,
    });
    expect(all).toHaveLength(2);
  });

  it("ORG-008 isole commandes, contacts et journal par espace", async () => {
    const first = await setup(db, "org-008-tenant-a");
    const second = await setup(db, "org-008-tenant-b");
    await saveEmailAccount(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      data: accountData(),
    });
    const transport = recorder();
    const result = await send(db, first, first.requestedOrderId, transport);

    expect(await getExchangeMessage(db, second.tenantId, result.messageId)).toBeNull();
    expect(await listExchangeMessages(db, { tenantId: second.tenantId })).toHaveLength(0);
    await expect(send(db, second, first.requestedOrderId, transport)).rejects.toThrow(
      /Commande introuvable/,
    );
    const recipients = await listExchangeRecipients(db, second.tenantId, first.supplierId);
    expect(recipients).toEqual([]);
  });

  it("ORG-009 fige le corps journalisé quand la fiche change ensuite", async () => {
    const tenant = await setup(db, "org-009-snapshot");
    await saveEmailAccount(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: accountData(),
    });
    const transport = recorder();
    const first = await send(db, tenant, tenant.requestedOrderId, transport);
    const before = await getExchangeMessage(db, tenant.tenantId, first.messageId);

    await updateCompanySettings(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: {
        legalName: "Lean Distribution SA",
        legalForm: "SA",
        capitalXof: null,
        taxId: "CI-9999999 B",
        rccm: null,
        addressLine: null,
        city: null,
        postalCode: null,
        countryCode: null,
        email: null,
        phone: null,
        website: null,
        invoiceFooter: null,
        paymentTermDays: 0,
        defaultIncoterm: null,
        bankName: null,
        bankAccountHolder: null,
        bankAccountNumber: null,
        bankSwift: null,
      },
    });

    const after = await getExchangeMessage(db, tenant.tenantId, first.messageId);
    expect(after?.bodyText).toBe(before?.bodyText);
    expect(after?.subject).toBe(before?.subject);
    expect(after?.bodyText).toContain("Lean SARL");
    expect(after?.bodyText).not.toContain("Lean Distribution");

    const second = await send(db, tenant, tenant.requestedOrderId, transport);
    const fresh = await getExchangeMessage(db, tenant.tenantId, second.messageId);
    expect(fresh?.bodyText).toContain("Lean Distribution");
  });
});

describe("ORG-008 — contexte d'envoi", () => {
  it("ORG-008 prépare destinataires, modèles et aperçu pour une commande demandée", async () => {
    const tenant = await setup(db, "org-008-context");
    const context = await getExchangeSendContext(db, {
      tenantId: tenant.tenantId,
      orderId: tenant.requestedOrderId,
      senderName: "Awa Koné",
      appUrl: "https://lean.test/",
    });
    expect(context.ready).toBe(true);
    if (!context.ready) {
      return;
    }
    expect(context.type).toBe("purchase_request");
    expect(context.recipients[0]?.email).toBe(tenant.contactEmail);
    expect(context.recipients[0]?.isPrimary).toBe(true);
    expect(context.templates[0]?.builtin).toBe(true);
    expect(context.values["order.number"]).toBe("");
    expect(context.values["document.link"]).toContain(`/achats/${tenant.requestedOrderId}`);
    expect(context.values["sender.name"]).toBe("Awa Koné");
    expect(context.lines.html).toContain("Café vert");
    expect(context.accountReady).toBe(false);
    expect(context.attachmentName).toMatch(/^demande-de-prix-/);
  });

  it("ORG-008 refuse le contexte d'une commande brouillon", async () => {
    const tenant = await setup(db, "org-008-context-draft");
    const draft = await createPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: {
        supplierId: tenant.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: tenant.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    const context = await getExchangeSendContext(db, {
      tenantId: tenant.tenantId,
      orderId: draft.id,
      senderName: "Awa Koné",
      appUrl: "https://lean.test",
    });
    expect(context.ready).toBe(false);
    if (!context.ready) {
      expect(context.reason).toMatch(/Demandez la commande/);
    }
  });

  it("ORG-008 renvoie un contexte non prêt sans raison sociale", async () => {
    const tenant = await seedPurchasingTenant(db, "org-008-context-nocompany");
    const order = await createPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      data: {
        supplierId: tenant.supplierId,
        expectedReceiptDate: "",
        externalReference: "",
        notes: "",
        lines: [{ articleId: tenant.productId, qty: "1", unitPriceXof: 1000 }],
      },
    });
    await transitionPurchaseOrder(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      orderId: order.id,
      action: "request",
    });
    const context = await getExchangeSendContext(db, {
      tenantId: tenant.tenantId,
      orderId: order.id,
      senderName: "Awa Koné",
      appUrl: "https://lean.test",
    });
    expect(context.ready).toBe(false);
    if (!context.ready) {
      expect(context.reason).toMatch(/raison sociale/);
    }
  });
});
