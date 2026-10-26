import nodemailer from "nodemailer";
import type { EmailSecurity } from "@/db/schema";

export interface MailAccountConfig {
  readonly host: string;
  readonly port: number;
  readonly security: EmailSecurity;
  readonly username: string | null;
  readonly password: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
}

export interface MailAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface OutgoingMail {
  readonly to: string;
  readonly toName: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attachments: readonly MailAttachment[];
}

export interface MailTransport {
  verify(): Promise<void>;
  send(message: OutgoingMail): Promise<{ messageId?: string }>;
}

export type TransportFactory = (config: MailAccountConfig) => MailTransport;

export function createSmtpTransport(config: MailAccountConfig): MailTransport {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    ignoreTLS: config.security === "none",
    auth:
      config.username && config.password
        ? { user: config.username, pass: config.password }
        : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });

  return {
    async verify() {
      await transport.verify();
    },
    async send(message) {
      const info = await transport.sendMail({
        from: { name: config.fromName, address: config.fromAddress },
        to: message.toName ? { name: message.toName, address: message.to } : message.to,
        replyTo: config.replyTo ?? undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.content),
          contentType: attachment.contentType,
        })),
      });
      return { messageId: info.messageId };
    },
  };
}

export const defaultTransportFactory: TransportFactory = createSmtpTransport;
