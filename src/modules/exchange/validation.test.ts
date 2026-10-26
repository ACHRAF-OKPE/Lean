import { describe, expect, it } from "vitest";
import { validateEmailAccount, validateExchangeSend, validateExchangeTemplate } from "./validation";

const ACCOUNT = {
  name: "SMTP transactionnel",
  host: "smtp.exemple.com",
  port: "587",
  security: "starttls",
  username: "achats@exemple.com",
  password: "secret",
  fromName: "Lean Achats",
  fromAddress: "achats@exemple.com",
  replyTo: "",
  active: true,
};

describe("ORG-006 — validation du compte d'envoi", () => {
  it("ORG-006 accepte un compte complet et normalise l'hôte et l'adresse", () => {
    const result = validateEmailAccount(
      { ...ACCOUNT, host: "SMTP.Exemple.COM", fromAddress: "Achats@Exemple.com" },
      { hasStoredPassword: false },
    );
    expect(result.errors).toEqual([]);
    expect(result.data.host).toBe("smtp.exemple.com");
    expect(result.data.fromAddress).toBe("achats@exemple.com");
    expect(result.data.passwordAction).toBe("set");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("ORG-006 refuse un hôte, un port ou une sécurité invalides", () => {
    for (const patch of [
      { host: "smtp exemple.com" },
      { host: "smtp..exemple.com" },
      { host: "" },
      { port: "0" },
      { port: "65536" },
      { port: "abc" },
      { port: "587.5" },
      { security: "ssl" },
      { fromAddress: "pas-une-adresse" },
      { name: "" },
      { fromName: "" },
    ]) {
      const result = validateEmailAccount({ ...ACCOUNT, ...patch }, { hasStoredPassword: true });
      expect(result.errors.length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
  });

  it("ORG-006 lie identifiant et mot de passe", () => {
    const withoutPassword = validateEmailAccount(
      { ...ACCOUNT, password: "" },
      { hasStoredPassword: false },
    );
    expect(withoutPassword.errors.join(" ")).toMatch(/Mot de passe/);

    const withStored = validateEmailAccount(
      { ...ACCOUNT, password: "" },
      { hasStoredPassword: true },
    );
    expect(withStored.errors).toEqual([]);
    expect(withStored.data.passwordAction).toBe("keep");

    const clearedWithUsername = validateEmailAccount(
      { ...ACCOUNT, password: "", removePassword: true },
      { hasStoredPassword: true },
    );
    expect(clearedWithUsername.errors.join(" ")).toMatch(/identifiant/);

    const passwordWithoutUsername = validateEmailAccount(
      { ...ACCOUNT, username: "", password: "secret" },
      { hasStoredPassword: false },
    );
    expect(passwordWithoutUsername.errors.join(" ")).toMatch(/identifiant/);

    const anonymous = validateEmailAccount(
      { ...ACCOUNT, username: "", password: "" },
      { hasStoredPassword: false },
    );
    expect(anonymous.errors).toEqual([]);
    expect(anonymous.data.passwordAction).toBe("clear");
  });
});

const TEMPLATE = {
  name: "Demande standard",
  type: "purchase_request",
  subject: "Demande {{order.number}} — {{company.legal_name}}",
  body: "Bonjour {{supplier.contact}},\n\n{{order.lines}}\n\nCordialement.",
  isDefault: true,
  active: true,
};

describe("ORG-007 — validation du modèle d'échange", () => {
  it("ORG-007 accepte un modèle valide", () => {
    const result = validateExchangeTemplate(TEMPLATE);
    expect(result.errors).toEqual([]);
    expect(result.data.name).toBe("Demande standard");
    expect(result.data.type).toBe("purchase_request");
  });

  it("ORG-007 refuse une variable inconnue", () => {
    const result = validateExchangeTemplate({
      ...TEMPLATE,
      body: "Bonjour {{supplier.inconnu}}",
    });
    expect(result.errors.join(" ")).toMatch(/\{\{supplier\.inconnu\}\}/);
  });

  it("ORG-007 refuse le tableau des lignes dans le sujet et les retours à la ligne", () => {
    const linesInSubject = validateExchangeTemplate({
      ...TEMPLATE,
      subject: "Lignes {{order.lines}}",
    });
    expect(linesInSubject.errors.join(" ")).toMatch(/tableau des lignes/);

    const newline = validateExchangeTemplate({ ...TEMPLATE, subject: "Sujet\nsecond" });
    expect(newline.errors.join(" ")).toMatch(/retours à la ligne/);
  });

  it("ORG-007 refuse un modèle par défaut inactif et les longueurs hors bornes", () => {
    const inactive = validateExchangeTemplate({ ...TEMPLATE, active: false });
    expect(inactive.errors.join(" ")).toMatch(/par défaut doit rester actif/);

    const longSubject = validateExchangeTemplate({ ...TEMPLATE, subject: "a".repeat(201) });
    expect(longSubject.errors.join(" ")).toMatch(/Sujet/);

    const longBody = validateExchangeTemplate({ ...TEMPLATE, body: "a".repeat(6001) });
    expect(longBody.errors.join(" ")).toMatch(/Corps/);
  });
});

describe("ORG-008 — validation de l'envoi", () => {
  it("ORG-008 refuse un destinataire vide ou invalide", () => {
    const result = validateExchangeSend({
      recipient: "pas-une-adresse",
      subject: "Sujet",
      body: "Corps",
    });
    expect(result.errors.join(" ")).toMatch(/Destinataire/);
  });

  it("ORG-008 accepte un envoi complet et normalise l'adresse", () => {
    const result = validateExchangeSend({
      recipient: "Contact@Sahel.test",
      subject: "Demande",
      body: "Bonjour",
    });
    expect(result.errors).toEqual([]);
    expect(result.data.recipient).toBe("contact@sahel.test");
  });
});
