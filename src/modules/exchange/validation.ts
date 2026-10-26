import type { EmailSecurity, ExchangeType } from "@/db/schema";
import { extractTemplateVariables, unknownTemplateVariables } from "./variables";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export const EMAIL_SECURITY_MODES: readonly EmailSecurity[] = ["tls", "starttls", "none"];
export const EXCHANGE_TYPES: readonly ExchangeType[] = [
  "purchase_request",
  "purchase_confirmation",
];
export const MAX_ACCOUNT_NAME = 80;
export const MAX_FROM_NAME = 120;
export const MAX_SUBJECT = 200;
export const MAX_TEMPLATE_BODY = 6000;

export interface ExchangeValidation<T> {
  readonly data: T;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface EmailAccountData {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly security: EmailSecurity;
  readonly username: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
  readonly active: boolean;
  readonly passwordAction: "keep" | "set" | "clear";
  readonly password: string | null;
}

export interface ExchangeTemplateData {
  readonly name: string;
  readonly type: ExchangeType;
  readonly subject: string;
  readonly body: string;
  readonly isDefault: boolean;
  readonly active: boolean;
}

export interface ExchangeSendData {
  readonly recipient: string;
  readonly recipientName: string | null;
  readonly subject: string;
  readonly body: string;
}

export function isValidEmail(value: string): boolean {
  return value.length <= 160 && EMAIL_PATTERN.test(value);
}

export function isExchangeType(value: unknown): value is ExchangeType {
  return typeof value === "string" && (EXCHANGE_TYPES as readonly string[]).includes(value);
}

export function isEmailSecurity(value: unknown): value is EmailSecurity {
  return typeof value === "string" && (EMAIL_SECURITY_MODES as readonly string[]).includes(value);
}

function clean(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function email(
  raw: unknown,
  label: string,
  errors: string[],
  warnings: string[],
  required: boolean,
): string | null {
  const value = clean(raw).toLowerCase();
  if (!value) {
    if (required) {
      errors.push(`${label} : adresse obligatoire.`);
    }
    return null;
  }
  if (value !== clean(raw)) {
    warnings.push(`${label} : adresse normalisée en minuscules.`);
  }
  if (!isValidEmail(value)) {
    errors.push(`${label} : adresse invalide.`);
    return null;
  }
  return value;
}

export function validateEmailAccount(
  raw: {
    name?: unknown;
    host?: unknown;
    port?: unknown;
    security?: unknown;
    username?: unknown;
    password?: unknown;
    removePassword?: boolean;
    fromName?: unknown;
    fromAddress?: unknown;
    replyTo?: unknown;
    active?: boolean;
  },
  options: { hasStoredPassword: boolean },
): ExchangeValidation<EmailAccountData> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = clean(raw.name);
  if (name.length < 1 || name.length > MAX_ACCOUNT_NAME) {
    errors.push(`Nom du compte : 1 à ${MAX_ACCOUNT_NAME} caractères.`);
  }

  const host = clean(raw.host).toLowerCase();
  if (host !== clean(raw.host) && clean(raw.host)) {
    warnings.push("Hôte : normalisé en minuscules.");
  }
  if (host.length < 1 || host.length > 255 || !HOST_PATTERN.test(host) || host.includes("..")) {
    errors.push("Hôte : nom de serveur invalide (lettres, chiffres, points et tirets).");
  }

  const portText = clean(raw.port);
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("Port : entier entre 1 et 65535.");
  }

  const security = raw.security;
  if (!isEmailSecurity(security)) {
    errors.push("Sécurité : choisissez TLS implicite, STARTTLS ou aucun.");
  }

  const username = clean(raw.username) || null;
  if (username && username.length > 120) {
    errors.push("Identifiant : 120 caractères maximum.");
  }

  const passwordText =
    raw.password === null || raw.password === undefined ? "" : String(raw.password);
  let passwordAction: EmailAccountData["passwordAction"] = "keep";
  let password: string | null = null;
  if (raw.removePassword) {
    passwordAction = "clear";
  } else if (passwordText.length > 0) {
    if (passwordText.length > 200) {
      errors.push("Mot de passe : 200 caractères maximum.");
    }
    passwordAction = "set";
    password = passwordText;
  }
  if (!username && passwordAction === "set") {
    errors.push("Mot de passe : renseignez un identifiant ou retirez le mot de passe.");
  }
  if (username && passwordAction === "keep" && !options.hasStoredPassword) {
    errors.push("Mot de passe : obligatoire pour un nouveau compte avec identifiant.");
  }
  if (username && passwordAction === "clear") {
    errors.push("Mot de passe : un identifiant ne peut pas rester sans mot de passe.");
  }
  if (!username) {
    passwordAction = "clear";
    password = null;
  }

  const fromName = clean(raw.fromName);
  if (fromName.length < 1 || fromName.length > MAX_FROM_NAME) {
    errors.push(`Nom de l'expéditeur : 1 à ${MAX_FROM_NAME} caractères.`);
  }

  const fromAddress = email(raw.fromAddress, "Adresse d'expédition", errors, warnings, true);
  const replyTo = email(raw.replyTo, "Réponse à", errors, warnings, false);

  const data: EmailAccountData = {
    name,
    host,
    port,
    security: isEmailSecurity(security) ? security : "tls",
    username,
    fromName,
    fromAddress: fromAddress ?? "",
    replyTo,
    active: raw.active !== false,
    passwordAction,
    password,
  };

  return { data, errors, warnings };
}

export function validateExchangeTemplate(raw: {
  name?: unknown;
  type?: unknown;
  subject?: unknown;
  body?: unknown;
  isDefault?: boolean;
  active?: boolean;
}): ExchangeValidation<ExchangeTemplateData> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = clean(raw.name);
  if (name.length < 1 || name.length > 120) {
    errors.push("Nom du modèle : 1 à 120 caractères.");
  }

  if (!isExchangeType(raw.type)) {
    errors.push("Type : choisissez une demande ou une confirmation fournisseur.");
  }

  const subject = clean(raw.subject);
  if (subject.length < 1 || subject.length > MAX_SUBJECT) {
    errors.push(`Sujet : 1 à ${MAX_SUBJECT} caractères.`);
  }
  if (/[\r\n]/.test(subject)) {
    errors.push("Sujet : les retours à la ligne sont interdits.");
  }

  const body = clean(raw.body);
  if (body.length < 1 || body.length > MAX_TEMPLATE_BODY) {
    errors.push(`Corps : 1 à ${MAX_TEMPLATE_BODY} caractères.`);
  }

  const unknown = unknownTemplateVariables(subject, body);
  if (unknown.length > 0) {
    errors.push(`Variables inconnues : ${unknown.map((token) => `{{${token}}}`).join(", ")}.`);
  }
  if (extractTemplateVariables(subject).includes("order.lines")) {
    errors.push("Sujet : le tableau des lignes ne peut pas figurer dans le sujet.");
  }

  const isDefault = raw.isDefault === true;
  const active = raw.active !== false;
  if (isDefault && !active) {
    errors.push("Un modèle par défaut doit rester actif.");
  }

  const data: ExchangeTemplateData = {
    name,
    type: isExchangeType(raw.type) ? raw.type : "purchase_request",
    subject,
    body,
    isDefault,
    active,
  };

  return { data, errors, warnings };
}

export function validateExchangeSend(raw: {
  recipient?: unknown;
  recipientName?: unknown;
  subject?: unknown;
  body?: unknown;
}): ExchangeValidation<ExchangeSendData> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const recipient = email(raw.recipient, "Destinataire", errors, warnings, true);
  const subject = clean(raw.subject);
  if (subject.length < 1 || subject.length > MAX_SUBJECT) {
    errors.push(`Sujet : 1 à ${MAX_SUBJECT} caractères.`);
  }
  if (/[\r\n]/.test(subject)) {
    errors.push("Sujet : les retours à la ligne sont interdits.");
  }
  const body = String(raw.body ?? "").trim();
  if (body.length < 1 || body.length > MAX_TEMPLATE_BODY) {
    errors.push(`Corps : 1 à ${MAX_TEMPLATE_BODY} caractères.`);
  }

  const recipientNameRaw = clean(raw.recipientName);

  return {
    data: {
      recipient: recipient ?? "",
      recipientName: recipientNameRaw || null,
      subject,
      body,
    },
    errors,
    warnings,
  };
}
