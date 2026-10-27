import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  emailAccounts,
  exchangeMessages,
  exchangeTemplates,
  partnerContacts,
  partners,
  purchaseOrders,
  users,
  type ExchangeMessageStatus,
  type ExchangeType,
} from "@/db/schema";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import {
  getCompanySettings,
  getCompanyLogo,
  type CompanySettingsSummary,
} from "@/modules/settings/queries";
import { formatQuantity } from "@/modules/stock/quantities";
import { getPurchaseOrder, type PurchaseOrderDetail } from "@/modules/purchases/queries";
import type { MailAccountConfig, TransportFactory } from "./mailer";
import { defaultTransportFactory } from "./mailer";
import { buildPurchaseDocument, countryLabel } from "./document-model";
import { renderPurchaseDocumentPdf } from "./document";
import { ExchangeError } from "./errors";
import { renderExchangeLines, renderExchangeTemplate } from "./render";
import { decryptSecret, encryptSecret } from "./secrets";
import { builtinExchangeTemplate } from "./templates";
import {
  isExchangeType,
  isValidEmail,
  type EmailAccountData,
  type ExchangeTemplateData,
} from "./validation";

export interface EmailAccountSummary {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly security: "tls" | "starttls" | "none";
  readonly username: string | null;
  readonly hasPassword: boolean;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
  readonly active: boolean;
  readonly updatedAt: Date;
}

export interface EmailAccountConfig {
  readonly id: string;
  readonly active: boolean;
  readonly config: MailAccountConfig;
}

export interface ExchangeTemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly type: ExchangeType;
  readonly subject: string;
  readonly body: string;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly updatedAt: Date;
}

export interface ResolvedExchangeTemplate {
  readonly id: string | null;
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly builtin: boolean;
}

export interface ExchangeRecipient {
  readonly email: string;
  readonly name: string;
  readonly source: "contact" | "partner";
  readonly isPrimary: boolean;
}

export interface ExchangeMessageSummary {
  readonly id: string;
  readonly type: ExchangeType;
  readonly status: ExchangeMessageStatus;
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly supplierName: string;
  readonly recipient: string;
  readonly recipientName: string | null;
  readonly subject: string;
  readonly templateName: string;
  readonly errorMessage: string | null;
  readonly actorName: string | null;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}

export interface ExchangeMessageDetail extends ExchangeMessageSummary {
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly attachmentName: string;
  readonly providerMessageId: string | null;
  readonly resentFromId: string | null;
}

function safeError(error: unknown, secret?: string | null): string {
  let message = error instanceof Error ? error.message : String(error);
  if (secret) {
    message = message.split(secret).join("***");
  }
  return message.replace(/\s+/g, " ").trim().slice(0, 900) || "Erreur inconnue.";
}

const CREDENTIAL_FAILURE_PATTERN =
  /535|5\.7\.8|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i;

function credentialHint(message: string): string {
  if (!CREDENTIAL_FAILURE_PATTERN.test(message)) {
    return "";
  }
  return " Vérifiez l'identifiant et le mot de passe. Gmail et Yahoo exigent un mot de passe d'application ; avec Resend, l'identifiant est « resend » et le mot de passe la clé API ; pour Microsoft 365, l'authentification SMTP doit être autorisée par l'administrateur.";
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  if (!before) {
    return Object.keys(after);
  }
  return Object.keys(after).filter((key) => (before[key] ?? null) !== (after[key] ?? null));
}

export async function getEmailAccount(
  db: Database,
  tenantId: string,
): Promise<EmailAccountSummary | null> {
  const [row] = await db
    .select({
      id: emailAccounts.id,
      name: emailAccounts.name,
      host: emailAccounts.host,
      port: emailAccounts.port,
      security: emailAccounts.security,
      username: emailAccounts.username,
      passwordCiphertext: emailAccounts.passwordCiphertext,
      fromName: emailAccounts.fromName,
      fromAddress: emailAccounts.fromAddress,
      replyTo: emailAccounts.replyTo,
      active: emailAccounts.active,
      updatedAt: emailAccounts.updatedAt,
    })
    .from(emailAccounts)
    .where(eq(emailAccounts.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }
  const { passwordCiphertext, ...rest } = row;
  return { ...rest, security: rest.security, hasPassword: Boolean(passwordCiphertext) };
}

export async function getEmailAccountConfig(
  db: Database,
  tenantId: string,
): Promise<EmailAccountConfig | null> {
  const [row] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    active: row.active,
    config: {
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      password: row.passwordCiphertext ? decryptSecret(row.passwordCiphertext) : null,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      replyTo: row.replyTo,
    },
  };
}

export async function saveEmailAccount(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: EmailAccountData },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.tenantId, input.tenantId))
    .limit(1);

  let passwordCiphertext: string | null;
  if (input.data.passwordAction === "set" && input.data.password) {
    passwordCiphertext = encryptSecret(input.data.password);
  } else if (input.data.passwordAction === "clear") {
    passwordCiphertext = null;
  } else {
    passwordCiphertext = existing?.passwordCiphertext ?? null;
  }
  if (!input.data.username) {
    passwordCiphertext = null;
  }
  if (input.data.username && !passwordCiphertext) {
    throw new ExchangeError("Mot de passe : obligatoire pour un compte avec identifiant.");
  }

  const values = {
    name: input.data.name,
    host: input.data.host,
    port: input.data.port,
    security: input.data.security,
    username: input.data.username,
    passwordCiphertext,
    fromName: input.data.fromName,
    fromAddress: input.data.fromAddress,
    replyTo: input.data.replyTo,
    active: input.data.active,
    updatedAt: new Date(),
  };
  const before = existing
    ? {
        name: existing.name,
        host: existing.host,
        port: existing.port,
        security: existing.security,
        username: existing.username,
        fromName: existing.fromName,
        fromAddress: existing.fromAddress,
        replyTo: existing.replyTo,
        active: existing.active,
      }
    : null;
  const after = {
    name: values.name,
    host: values.host,
    port: values.port,
    security: values.security,
    username: values.username,
    fromName: values.fromName,
    fromAddress: values.fromAddress,
    replyTo: values.replyTo,
    active: values.active,
  };

  try {
    return await db.transaction(async (tx) => {
      let id: string;
      if (existing) {
        id = existing.id;
        await tx.update(emailAccounts).set(values).where(eq(emailAccounts.id, existing.id));
      } else {
        const [created] = await tx
          .insert(emailAccounts)
          .values({ tenantId: input.tenantId, ...values })
          .returning({ id: emailAccounts.id });
        if (!created) {
          throw new ExchangeError("Compte d'envoi non créé.");
        }
        id = created.id;
      }

      const fields = changedFields(before, after);
      if (
        (input.data.passwordAction === "set" || input.data.passwordAction === "clear") &&
        existing
      ) {
        fields.push("password");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "exchange.account.save",
        entityType: "email_account",
        entityId: id,
        details: {
          created: !existing,
          changedFields: fields,
          host: values.host,
          port: values.port,
          active: values.active,
        },
      });

      return { id, created: !existing };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ExchangeError("Un compte d'envoi existe déjà pour cet espace de travail.");
    }
    throw error;
  }
}

export async function testEmailAccountConnection(
  db: Database,
  input: { tenantId: string; actorUserId: string },
  factory: TransportFactory = defaultTransportFactory,
): Promise<{ host: string; port: number }> {
  const account = await getEmailAccountConfig(db, input.tenantId);
  if (!account || !account.active) {
    throw new ExchangeError("Compte d'envoi absent ou inactif : activez-le avant de tester.");
  }

  try {
    await factory(account.config).verify();
  } catch (error) {
    const message = safeError(error, account.config.password);
    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "exchange.account.test",
      entityType: "email_account",
      entityId: account.id,
      details: { status: "failed", host: account.config.host, error: message },
    });
    throw new ExchangeError(`Connexion SMTP refusée : ${message}${credentialHint(message)}`);
  }

  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "exchange.account.test",
    entityType: "email_account",
    entityId: account.id,
    details: { status: "sent", host: account.config.host, port: account.config.port },
  });
  return { host: account.config.host, port: account.config.port };
}

export async function listExchangeTemplates(
  db: Database,
  tenantId: string,
  type?: ExchangeType,
): Promise<readonly ExchangeTemplateSummary[]> {
  return db
    .select({
      id: exchangeTemplates.id,
      name: exchangeTemplates.name,
      type: exchangeTemplates.type,
      subject: exchangeTemplates.subject,
      body: exchangeTemplates.body,
      isDefault: exchangeTemplates.isDefault,
      active: exchangeTemplates.active,
      updatedAt: exchangeTemplates.updatedAt,
    })
    .from(exchangeTemplates)
    .where(
      type
        ? and(eq(exchangeTemplates.tenantId, tenantId), eq(exchangeTemplates.type, type))
        : eq(exchangeTemplates.tenantId, tenantId),
    )
    .orderBy(
      asc(exchangeTemplates.type),
      desc(exchangeTemplates.isDefault),
      asc(exchangeTemplates.name),
    );
}

export async function getExchangeTemplate(
  db: Database,
  tenantId: string,
  templateId: string,
): Promise<ExchangeTemplateSummary | null> {
  const [row] = await db
    .select({
      id: exchangeTemplates.id,
      name: exchangeTemplates.name,
      type: exchangeTemplates.type,
      subject: exchangeTemplates.subject,
      body: exchangeTemplates.body,
      isDefault: exchangeTemplates.isDefault,
      active: exchangeTemplates.active,
      updatedAt: exchangeTemplates.updatedAt,
    })
    .from(exchangeTemplates)
    .where(and(eq(exchangeTemplates.tenantId, tenantId), eq(exchangeTemplates.id, templateId)))
    .limit(1);
  return row ?? null;
}

export async function createExchangeTemplate(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: ExchangeTemplateData },
): Promise<{ id: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({ id: exchangeTemplates.id })
        .from(exchangeTemplates)
        .where(
          and(
            eq(exchangeTemplates.tenantId, input.tenantId),
            eq(exchangeTemplates.name, input.data.name),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new ExchangeError("Un modèle porte déjà ce nom.");
      }
      if (input.data.isDefault) {
        await tx
          .update(exchangeTemplates)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(exchangeTemplates.tenantId, input.tenantId),
              eq(exchangeTemplates.type, input.data.type),
              eq(exchangeTemplates.isDefault, true),
            ),
          );
      }

      const [created] = await tx
        .insert(exchangeTemplates)
        .values({
          tenantId: input.tenantId,
          name: input.data.name,
          type: input.data.type,
          subject: input.data.subject,
          body: input.data.body,
          isDefault: input.data.isDefault,
          active: input.data.active,
          createdBy: input.actorUserId,
        })
        .returning({ id: exchangeTemplates.id });
      if (!created) {
        throw new ExchangeError("Modèle non créé.");
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "exchange.template.create",
        entityType: "exchange_template",
        entityId: created.id,
        details: {
          name: input.data.name,
          type: input.data.type,
          isDefault: input.data.isDefault,
          active: input.data.active,
        },
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ExchangeError("Un modèle par défaut existe déjà pour ce type.");
    }
    throw error;
  }
}

export async function updateExchangeTemplate(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    templateId: string;
    data: ExchangeTemplateData;
  },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(exchangeTemplates)
        .where(
          and(
            eq(exchangeTemplates.tenantId, input.tenantId),
            eq(exchangeTemplates.id, input.templateId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new ExchangeError("Modèle introuvable dans cet espace de travail.");
      }
      const [duplicate] = await tx
        .select({ id: exchangeTemplates.id })
        .from(exchangeTemplates)
        .where(
          and(
            eq(exchangeTemplates.tenantId, input.tenantId),
            eq(exchangeTemplates.name, input.data.name),
          ),
        )
        .limit(1);
      if (duplicate && duplicate.id !== existing.id) {
        throw new ExchangeError("Un modèle porte déjà ce nom.");
      }
      if (input.data.isDefault) {
        await tx
          .update(exchangeTemplates)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(exchangeTemplates.tenantId, input.tenantId),
              eq(exchangeTemplates.type, input.data.type),
              eq(exchangeTemplates.isDefault, true),
            ),
          );
      }

      await tx
        .update(exchangeTemplates)
        .set({
          name: input.data.name,
          type: input.data.type,
          subject: input.data.subject,
          body: input.data.body,
          isDefault: input.data.isDefault,
          active: input.data.active,
          updatedAt: new Date(),
        })
        .where(eq(exchangeTemplates.id, existing.id));

      const before = {
        name: existing.name,
        type: existing.type,
        subject: existing.subject,
        body: existing.body,
        isDefault: existing.isDefault,
        active: existing.active,
      };
      const after = {
        name: input.data.name,
        type: input.data.type,
        subject: input.data.subject,
        body: input.data.body,
        isDefault: input.data.isDefault,
        active: input.data.active,
      };
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "exchange.template.update",
        entityType: "exchange_template",
        entityId: existing.id,
        details: {
          changedFields: changedFields(before, after),
          isDefault: input.data.isDefault,
          active: input.data.active,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ExchangeError("Un modèle par défaut existe déjà pour ce type.");
    }
    throw error;
  }
}

export async function resolveExchangeTemplate(
  db: Database,
  tenantId: string,
  type: ExchangeType,
  templateId?: string | null,
): Promise<ResolvedExchangeTemplate> {
  if (templateId) {
    const template = await getExchangeTemplate(db, tenantId, templateId);
    if (!template || template.type !== type || !template.active) {
      throw new ExchangeError("Modèle introuvable, inactif ou d'un autre type.");
    }
    return {
      id: template.id,
      name: template.name,
      subject: template.subject,
      body: template.body,
      builtin: false,
    };
  }

  const [row] = await db
    .select({
      id: exchangeTemplates.id,
      name: exchangeTemplates.name,
      subject: exchangeTemplates.subject,
      body: exchangeTemplates.body,
    })
    .from(exchangeTemplates)
    .where(
      and(
        eq(exchangeTemplates.tenantId, tenantId),
        eq(exchangeTemplates.type, type),
        eq(exchangeTemplates.active, true),
        eq(exchangeTemplates.isDefault, true),
      ),
    )
    .limit(1);
  if (row) {
    return { ...row, builtin: false };
  }

  const builtin = builtinExchangeTemplate(type);
  return { id: null, ...builtin, builtin: true };
}

export async function listExchangeRecipients(
  db: Database,
  tenantId: string,
  supplierId: string,
): Promise<readonly ExchangeRecipient[]> {
  const [supplier] = await db
    .select({ name: partners.name, email: partners.email })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, supplierId)))
    .limit(1);
  if (!supplier) {
    return [];
  }

  const contacts = await db
    .select({
      fullName: partnerContacts.fullName,
      email: partnerContacts.email,
      isPrimary: partnerContacts.isPrimary,
    })
    .from(partnerContacts)
    .where(
      and(
        eq(partnerContacts.tenantId, tenantId),
        eq(partnerContacts.partnerId, supplierId),
        eq(partnerContacts.active, true),
      ),
    )
    .orderBy(desc(partnerContacts.isPrimary), asc(partnerContacts.fullName));

  const recipients: ExchangeRecipient[] = [];
  for (const contact of contacts) {
    if (contact.email && !recipients.some((entry) => entry.email === contact.email)) {
      recipients.push({
        email: contact.email,
        name: contact.fullName,
        source: "contact",
        isPrimary: contact.isPrimary,
      });
    }
  }
  if (supplier.email && !recipients.some((entry) => entry.email === supplier.email)) {
    recipients.push({
      email: supplier.email,
      name: supplier.name,
      source: "partner",
      isPrimary: false,
    });
  }
  return recipients;
}

export async function getPrimaryContactName(
  db: Database,
  tenantId: string,
  supplierId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ fullName: partnerContacts.fullName })
    .from(partnerContacts)
    .where(
      and(
        eq(partnerContacts.tenantId, tenantId),
        eq(partnerContacts.partnerId, supplierId),
        eq(partnerContacts.active, true),
        eq(partnerContacts.isPrimary, true),
      ),
    )
    .limit(1);
  return row?.fullName ?? null;
}

interface SupplierSnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

async function getSupplierSnapshot(
  db: Database,
  tenantId: string,
  supplierId: string,
): Promise<SupplierSnapshot> {
  const [row] = await db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      addressLine: partners.addressLine,
      city: partners.city,
      countryCode: partners.countryCode,
      email: partners.email,
      phone: partners.phone,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, supplierId)))
    .limit(1);
  if (!row) {
    throw new ExchangeError("Fournisseur introuvable dans cet espace de travail.");
  }
  return row;
}

function allowedStatuses(type: ExchangeType): readonly string[] {
  return type === "purchase_request" ? ["requested"] : ["confirmed", "closed"];
}

function typeLabel(type: ExchangeType): string {
  return type === "purchase_request" ? "demande fournisseur" : "confirmation fournisseur";
}

function buildTemplateValues(input: {
  company: CompanySettingsSummary;
  supplier: SupplierSnapshot;
  order: PurchaseOrderDetail["order"] & { readonly lineCount: number };
  supplierContact: string;
  senderName: string;
  appUrl: string;
}): Record<string, string> {
  const { company, supplier, order, supplierContact, senderName, appUrl } = input;
  return {
    "company.legal_name": company.legalName,
    "company.legal_form": company.legalForm ?? "",
    "company.address": company.addressLine ?? "",
    "company.city": company.city ?? "",
    "company.country": countryLabel(company.countryCode) ?? "",
    "company.email": company.email ?? "",
    "company.phone": company.phone ?? "",
    "company.tax_id": company.taxId ?? "",
    "company.rccm": company.rccm ?? "",
    "company.payment_terms":
      company.paymentTermDays > 0 ? `${company.paymentTermDays} jours` : "comptant",
    "company.incoterm": company.defaultIncoterm ?? "",
    "company.bank_name": company.bankName ?? "",
    "company.bank_account": company.bankAccountNumber ?? "",
    "company.bank_swift": company.bankSwift ?? "",
    "company.footer": company.invoiceFooter ?? "",
    "supplier.name": supplier.name,
    "supplier.code": supplier.code,
    "supplier.contact": supplierContact,
    "supplier.email": supplier.email ?? "",
    "supplier.address": supplier.addressLine ?? "",
    "supplier.city": supplier.city ?? "",
    "supplier.country": countryLabel(supplier.countryCode) ?? "",
    "order.number": order.number ?? "",
    "order.date": isoDateLabel(order.orderDate),
    "order.expected_date": order.expectedReceiptDate ? isoDateLabel(order.expectedReceiptDate) : "",
    "order.external_reference": order.externalReference ?? "",
    "order.notes": order.notes ?? "",
    "order.total": formatXof(order.exTaxTotal),
    "order.line_count": String(order.lineCount ?? 0),
    "document.link": appUrl ? `${appUrl.replace(/\/$/, "")}/achats/${order.id}` : "",
    "sender.name": senderName,
  };
}

export interface SendPurchaseExchangeInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly senderName: string;
  readonly orderId: string;
  readonly type: ExchangeType;
  readonly templateId: string | null;
  readonly recipient: string;
  readonly recipientName: string | null;
  readonly subject: string;
  readonly body: string;
  readonly appUrl: string;
  readonly resentFromId?: string | null;
}

export interface SendPurchaseExchangeResult {
  readonly messageId: string;
  readonly recipient: string;
  readonly subject: string;
}

export async function sendPurchaseExchange(
  db: Database,
  input: SendPurchaseExchangeInput,
  factory: TransportFactory = defaultTransportFactory,
): Promise<SendPurchaseExchangeResult> {
  if (!isExchangeType(input.type)) {
    throw new ExchangeError("Type d'échange inconnu.");
  }
  if (!isValidEmail(input.recipient)) {
    throw new ExchangeError("Destinataire : adresse invalide.");
  }

  const detail = await getPurchaseOrder(db, { tenantId: input.tenantId, orderId: input.orderId });
  if (!detail) {
    throw new ExchangeError("Commande introuvable dans cet espace de travail.");
  }
  if (!allowedStatuses(input.type).includes(detail.order.status)) {
    throw new ExchangeError(
      `Une ${typeLabel(input.type)} exige une commande ${
        input.type === "purchase_request" ? "demandée" : "confirmée ou clôturée"
      }. Statut actuel : ${detail.order.status}.`,
    );
  }

  const company = await getCompanySettings(db, input.tenantId);
  if (!company?.legalName) {
    throw new ExchangeError(
      "Complétez la raison sociale dans les paramètres avant d'émettre un document.",
    );
  }

  const supplier = await getSupplierSnapshot(db, input.tenantId, detail.order.supplierId);
  const template = await resolveExchangeTemplate(db, input.tenantId, input.type, input.templateId);
  const primaryContact = await getPrimaryContactName(db, input.tenantId, supplier.id);
  const values = buildTemplateValues({
    company,
    supplier,
    order: { ...detail.order, lineCount: detail.lines.length },
    supplierContact: input.recipientName ?? primaryContact ?? supplier.name,
    senderName: input.senderName,
    appUrl: input.appUrl,
  });

  const lines = renderExchangeLines(
    detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      name: line.articleName,
      unitCode: line.unitCode,
      qty: formatQuantity(line.qty),
      unitPriceLabel: formatXof(line.unitPriceXof),
      totalLabel: formatXof(line.lineTotalXof),
    })),
  );
  const rendered = renderExchangeTemplate(
    input.subject.trim() ? input.subject : template.subject,
    input.body.trim() ? input.body : template.body,
    values,
    lines,
  );
  const subject = rendered.subject || `${typeLabel(input.type)} — ${company.legalName}`;
  if (subject.length > 200) {
    throw new ExchangeError("Sujet : 200 caractères maximum après remplacement des variables.");
  }

  const document = buildPurchaseDocument({
    type: input.type,
    company,
    supplier,
    order: detail.order,
    lines: detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      name: line.articleName,
      unitCode: line.unitCode,
      qty: line.qty,
      unitPriceXof: line.unitPriceXof,
      lineTotalXof: line.lineTotalXof,
    })),
  });
  const logo = await getCompanyLogo(db, input.tenantId);
  const pdf = await renderPurchaseDocumentPdf(
    document,
    logo ? { mime: logo.mime, data: logo.data } : null,
  );

  const account = await getEmailAccountConfig(db, input.tenantId);
  if (!account || !account.active) {
    throw new ExchangeError("Compte d'envoi absent ou inactif : configurez-le avant d'envoyer.");
  }

  let providerMessageId: string | null = null;
  try {
    const transport = factory(account.config);
    const sent = await transport.send({
      to: input.recipient,
      toName: input.recipientName,
      subject,
      text: rendered.text,
      html: rendered.html,
      attachments: [{ filename: pdf.fileName, content: pdf.bytes, contentType: "application/pdf" }],
    });
    providerMessageId = sent.messageId ?? null;
  } catch (error) {
    const message = safeError(error, account.config.password);
    const [row] = await db
      .insert(exchangeMessages)
      .values({
        tenantId: input.tenantId,
        type: input.type,
        status: "failed",
        orderId: detail.order.id,
        templateId: template.id,
        templateName: template.name,
        recipient: input.recipient,
        recipientName: input.recipientName,
        subject,
        bodyText: rendered.text.slice(0, 20000) || subject,
        bodyHtml: rendered.html.slice(0, 60000) || subject,
        attachmentName: pdf.fileName,
        errorMessage: message,
        actorUserId: input.actorUserId,
        resentFromId: input.resentFromId ?? null,
      })
      .returning({ id: exchangeMessages.id });
    if (row) {
      await db.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "exchange.message.send",
        entityType: "exchange_message",
        entityId: row.id,
        details: {
          status: "failed",
          type: input.type,
          orderId: detail.order.id,
          recipient: input.recipient,
          templateName: template.name,
          error: message,
        },
      });
    }
    throw new ExchangeError(`Envoi refusé : ${message}${credentialHint(message)}`);
  }

  const [row] = await db
    .insert(exchangeMessages)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      status: "sent",
      orderId: detail.order.id,
      templateId: template.id,
      templateName: template.name,
      recipient: input.recipient,
      recipientName: input.recipientName,
      subject,
      bodyText: rendered.text.slice(0, 20000),
      bodyHtml: rendered.html.slice(0, 60000),
      attachmentName: pdf.fileName,
      providerMessageId,
      actorUserId: input.actorUserId,
      resentFromId: input.resentFromId ?? null,
      sentAt: new Date(),
    })
    .returning({ id: exchangeMessages.id });
  if (!row) {
    throw new ExchangeError("Journal d'échange non écrit.");
  }
  const messageId = row.id;
  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "exchange.message.send",
    entityType: "exchange_message",
    entityId: messageId,
    details: {
      status: "sent",
      type: input.type,
      orderId: detail.order.id,
      recipient: input.recipient,
      templateName: template.name,
      attachment: pdf.fileName,
    },
  });
  return { messageId, recipient: input.recipient, subject };
}

export async function resendExchangeMessage(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    senderName: string;
    messageId: string;
    appUrl: string;
  },
  factory: TransportFactory = defaultTransportFactory,
): Promise<SendPurchaseExchangeResult> {
  const [row] = await db
    .select()
    .from(exchangeMessages)
    .where(
      and(eq(exchangeMessages.tenantId, input.tenantId), eq(exchangeMessages.id, input.messageId)),
    )
    .limit(1);
  if (!row) {
    throw new ExchangeError("Message introuvable dans cet espace de travail.");
  }

  return sendPurchaseExchange(
    db,
    {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      senderName: input.senderName,
      orderId: row.orderId,
      type: row.type,
      templateId: row.templateId,
      recipient: row.recipient,
      recipientName: row.recipientName,
      subject: row.subject,
      body: row.bodyText,
      appUrl: input.appUrl,
      resentFromId: row.id,
    },
    factory,
  );
}

export interface ExchangeTemplateChoice {
  readonly id: string | null;
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly builtin: boolean;
}

export type ExchangeSendContext =
  | { readonly ready: false; readonly reason: string }
  | {
      readonly ready: true;
      readonly order: {
        readonly id: string;
        readonly number: string | null;
        readonly status: PurchaseOrderDetail["order"]["status"];
        readonly orderDate: string;
        readonly supplierName: string;
        readonly exTaxTotal: number;
      };
      readonly type: ExchangeType;
      readonly typeLabel: string;
      readonly recipients: readonly ExchangeRecipient[];
      readonly templates: readonly ExchangeTemplateChoice[];
      readonly values: Readonly<Record<string, string>>;
      readonly lines: { readonly text: string; readonly html: string };
      readonly attachmentName: string;
      readonly accountReady: boolean;
    };

function exchangeTypeForStatus(
  status: PurchaseOrderDetail["order"]["status"],
): ExchangeType | null {
  if (status === "requested") {
    return "purchase_request";
  }
  if (status === "confirmed" || status === "closed") {
    return "purchase_confirmation";
  }
  return null;
}

export async function getExchangeSendContext(
  db: Database,
  input: {
    tenantId: string;
    orderId: string;
    senderName: string;
    appUrl: string;
  },
): Promise<ExchangeSendContext> {
  const detail = await getPurchaseOrder(db, { tenantId: input.tenantId, orderId: input.orderId });
  if (!detail) {
    throw new ExchangeError("Commande introuvable dans cet espace de travail.");
  }
  const type = exchangeTypeForStatus(detail.order.status);
  if (!type) {
    return {
      ready: false,
      reason:
        detail.order.status === "draft"
          ? "Demandez la commande avant d'envoyer une demande fournisseur."
          : "Une commande annulée ne peut plus être transmise.",
    };
  }

  const company = await getCompanySettings(db, input.tenantId);
  if (!company?.legalName) {
    return {
      ready: false,
      reason:
        "Complétez la raison sociale dans les paramètres avant d'émettre un document fournisseur.",
    };
  }

  const supplier = await getSupplierSnapshot(db, input.tenantId, detail.order.supplierId);
  const primaryContact = await getPrimaryContactName(db, input.tenantId, supplier.id);
  const values = buildTemplateValues({
    company,
    supplier,
    order: { ...detail.order, lineCount: detail.lines.length },
    supplierContact: primaryContact ?? supplier.name,
    senderName: input.senderName,
    appUrl: input.appUrl,
  });
  const lines = renderExchangeLines(
    detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      name: line.articleName,
      unitCode: line.unitCode,
      qty: formatQuantity(line.qty),
      unitPriceLabel: formatXof(line.unitPriceXof),
      totalLabel: formatXof(line.lineTotalXof),
    })),
  );

  const activeTemplates = (await listExchangeTemplates(db, input.tenantId, type)).filter(
    (template) => template.active,
  );
  const choices: ExchangeTemplateChoice[] = [];
  if (!activeTemplates.some((template) => template.isDefault)) {
    const builtin = builtinExchangeTemplate(type);
    choices.push({
      id: null,
      name: builtin.name,
      subject: builtin.subject,
      body: builtin.body,
      builtin: true,
    });
  }
  for (const template of activeTemplates) {
    choices.push({
      id: template.id,
      name: template.name,
      subject: template.subject,
      body: template.body,
      builtin: false,
    });
  }

  const document = buildPurchaseDocument({
    type,
    company,
    supplier,
    order: detail.order,
    lines: detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      name: line.articleName,
      unitCode: line.unitCode,
      qty: line.qty,
      unitPriceXof: line.unitPriceXof,
      lineTotalXof: line.lineTotalXof,
    })),
  });
  const account = await getEmailAccountConfig(db, input.tenantId);

  return {
    ready: true,
    order: {
      id: detail.order.id,
      number: detail.order.number,
      status: detail.order.status,
      orderDate: detail.order.orderDate,
      supplierName: detail.order.supplierName,
      exTaxTotal: detail.order.exTaxTotal,
    },
    type,
    typeLabel: typeLabel(type),
    recipients: await listExchangeRecipients(db, input.tenantId, supplier.id),
    templates: choices,
    values,
    lines,
    attachmentName: document.attachmentName,
    accountReady: Boolean(account?.active),
  };
}

const MESSAGE_SUMMARY_COLUMNS = {
  id: exchangeMessages.id,
  type: exchangeMessages.type,
  status: exchangeMessages.status,
  orderId: exchangeMessages.orderId,
  orderNumber: purchaseOrders.number,
  supplierName: partners.name,
  recipient: exchangeMessages.recipient,
  recipientName: exchangeMessages.recipientName,
  subject: exchangeMessages.subject,
  templateName: exchangeMessages.templateName,
  errorMessage: exchangeMessages.errorMessage,
  actorName: users.name,
  createdAt: exchangeMessages.createdAt,
  sentAt: exchangeMessages.sentAt,
};

function messageQuery(db: Database) {
  return db
    .select(MESSAGE_SUMMARY_COLUMNS)
    .from(exchangeMessages)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.tenantId, exchangeMessages.tenantId),
        eq(purchaseOrders.id, exchangeMessages.orderId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .leftJoin(users, eq(users.id, exchangeMessages.actorUserId));
}

export async function listExchangeMessages(
  db: Database,
  input: { tenantId: string; orderId?: string; limit?: number },
): Promise<readonly ExchangeMessageSummary[]> {
  return messageQuery(db)
    .where(
      input.orderId
        ? and(
            eq(exchangeMessages.tenantId, input.tenantId),
            eq(exchangeMessages.orderId, input.orderId),
          )
        : eq(exchangeMessages.tenantId, input.tenantId),
    )
    .orderBy(desc(exchangeMessages.createdAt))
    .limit(input.limit ?? 100);
}

export async function getExchangeMessage(
  db: Database,
  tenantId: string,
  messageId: string,
): Promise<ExchangeMessageDetail | null> {
  const [row] = await db
    .select({
      ...MESSAGE_SUMMARY_COLUMNS,
      bodyText: exchangeMessages.bodyText,
      bodyHtml: exchangeMessages.bodyHtml,
      attachmentName: exchangeMessages.attachmentName,
      providerMessageId: exchangeMessages.providerMessageId,
      resentFromId: exchangeMessages.resentFromId,
    })
    .from(exchangeMessages)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.tenantId, exchangeMessages.tenantId),
        eq(purchaseOrders.id, exchangeMessages.orderId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, purchaseOrders.tenantId),
        eq(partners.id, purchaseOrders.supplierId),
      ),
    )
    .leftJoin(users, eq(users.id, exchangeMessages.actorUserId))
    .where(and(eq(exchangeMessages.tenantId, tenantId), eq(exchangeMessages.id, messageId)))
    .limit(1);
  return row ?? null;
}

export async function getDefaultExchangeTemplateId(
  db: Database,
  tenantId: string,
  type: ExchangeType,
): Promise<string | null> {
  const [row] = await db
    .select({ id: exchangeTemplates.id })
    .from(exchangeTemplates)
    .where(
      and(
        eq(exchangeTemplates.tenantId, tenantId),
        eq(exchangeTemplates.type, type),
        eq(exchangeTemplates.active, true),
        eq(exchangeTemplates.isDefault, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
