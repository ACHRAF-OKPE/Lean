import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpTransport, type MailAccountConfig } from "./mailer";

const USER = "achats@lean.test";
const PASSWORD = "secret-smtp-42";
const received: string[] = [];

let server: SMTPServer;
let port: number;

function config(patch: Partial<MailAccountConfig> = {}): MailAccountConfig {
  return {
    host: "127.0.0.1",
    port,
    security: "none",
    username: USER,
    password: PASSWORD,
    fromName: "Lean Achats",
    fromAddress: USER,
    replyTo: "reponse@lean.test",
    ...patch,
  };
}

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === USER && auth.password === PASSWORD) {
        callback(null, { user: auth.username });
        return;
      }
      callback(new Error("Invalid username or password"));
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ORG-006 — test du compte SMTP réel", () => {
  it("ORG-006 valide une connexion authentifiée sans envoyer de message", async () => {
    const transport = createSmtpTransport(config());
    await expect(transport.verify()).resolves.toBeUndefined();
    expect(received).toHaveLength(0);
  });

  it("ORG-006 refuse un mot de passe erroné", async () => {
    const transport = createSmtpTransport(config({ password: "mauvais" }));
    await expect(transport.verify()).rejects.toThrow();
  });
});

describe("ORG-008 — remise SMTP réelle", () => {
  it("ORG-008 remet le message avec sujet français et pièce jointe PDF", async () => {
    const transport = createSmtpTransport(config());
    const pdf = Buffer.from("%PDF-1.4\n%test\n", "utf8");
    const info = await transport.send({
      to: "mariam@sahel.test",
      toName: "Mariam Traoré",
      subject: "Demande de prix — Lean SARL",
      text: "Bonjour Mariam, voici notre demande.",
      html: "<p>Bonjour Mariam, voici notre demande.</p>",
      attachments: [
        {
          filename: "demande-de-prix-cmd-2026-0001.pdf",
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });

    expect(info.messageId).toBeTruthy();
    expect(received).toHaveLength(1);
    const raw = received[0]!;
    expect(raw).toContain("From: Lean Achats <achats@lean.test>");
    expect(raw).toContain("mariam@sahel.test");
    expect(raw).toContain("Reply-To: reponse@lean.test");
    expect(raw).toMatch(/Subject: =\?UTF-8\?/i);
    expect(raw).toContain("Content-Type: application/pdf");
    expect(raw).toContain("demande-de-prix-cmd-2026-0001.pdf");
    expect(raw).toContain("Bonjour Mariam");
  });
});
