import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  appendReplyLink,
  buildReplyLink,
  createReplyToken,
  hashReplyToken,
  isReplyTokenShape,
  validateSupplierAttachment,
  validateSupplierReply,
} from "./replies";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function replyRaw(patch: Record<string, unknown> = {}) {
  return {
    authorName: "Mariam Traoré",
    authorEmail: "Mariam@Sahel.test",
    availability: "available",
    comment: "",
    leadTimeDays: "",
    proposedTotalXof: "",
    ...patch,
  };
}

describe("REP-001 — jeton de réponse", () => {
  it("REP-001 génère un jeton base64url de 43 caractères et n'en stocke que l'empreinte", () => {
    const first = createReplyToken(new Date("2026-10-28T08:00:00Z"));
    const second = createReplyToken(new Date("2026-10-28T08:00:00Z"));

    expect(first.token).toHaveLength(43);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(first.hash).toHaveLength(64);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(hashReplyToken(first.token));
    expect(first.hash).not.toContain(first.token);
    expect(first.expiresAt.toISOString()).toBe("2027-01-26T08:00:00.000Z");
  });

  it("REP-001 construit le lien et l'ajoute au texte et au HTML avec échappement", () => {
    const token = createReplyToken().token;
    const link = buildReplyLink("https://lean.test/", token);

    expect(link).toBe(`https://lean.test/repondre/${token}`);
    expect(isReplyTokenShape(token)).toBe(true);
    expect(isReplyTokenShape("trop-court")).toBe(false);
    expect(isReplyTokenShape(`${token}!`)).toBe(false);

    const body = appendReplyLink("Bonjour", "<div>Bonjour</div>", "https://lean.test/?a=1&b=2");
    expect(body.text).toContain("https://lean.test/?a=1&b=2");
    expect(body.text).toContain("Répondre en ligne");
    expect(body.html).toContain('href="https://lean.test/?a=1&amp;b=2"');
  });
});

describe("REP-003 — validation de la réponse", () => {
  it("REP-003 accepte une réponse disponible minimale et normalise l'e-mail", () => {
    const result = validateSupplierReply(replyRaw(), null);

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      authorName: "Mariam Traoré",
      authorEmail: "mariam@sahel.test",
      availability: "available",
      comment: null,
      leadTimeDays: null,
      proposedTotalXof: null,
      attachment: null,
    });
  });

  it("REP-003 refuse nom vide, disponibilité inconnue, commentaire manquant ou trop long", () => {
    expect(validateSupplierReply(replyRaw({ authorName: "" }), null).errors).toContain(
      "Nom : 1 à 120 caractères.",
    );
    expect(validateSupplierReply(replyRaw({ authorName: "x".repeat(121) }), null).errors).toContain(
      "Nom : 1 à 120 caractères.",
    );
    expect(validateSupplierReply(replyRaw({ availability: "peut-être" }), null).errors).toContain(
      "Disponibilité : choisissez disponible, partiellement disponible ou indisponible.",
    );
    expect(
      validateSupplierReply(replyRaw({ availability: "partial", comment: "" }), null).errors,
    ).toContain(
      "Commentaire : précisez le motif quand la commande n'est pas entièrement disponible.",
    );
    expect(validateSupplierReply(replyRaw({ comment: "x".repeat(2001) }), null).errors).toContain(
      "Commentaire : 2000 caractères maximum.",
    );
    expect(
      validateSupplierReply(replyRaw({ availability: "unavailable", comment: "Rupture" }), null)
        .errors,
    ).toEqual([]);
  });

  it("REP-003 refuse délai hors bornes, montant décimal ou négatif et e-mail invalide", () => {
    expect(validateSupplierReply(replyRaw({ leadTimeDays: "-1" }), null).errors).toHaveLength(1);
    expect(validateSupplierReply(replyRaw({ leadTimeDays: "366" }), null).errors).toHaveLength(1);
    expect(validateSupplierReply(replyRaw({ leadTimeDays: "12,5" }), null).errors).toHaveLength(1);
    expect(validateSupplierReply(replyRaw({ leadTimeDays: "365" }), null).errors).toEqual([]);
    expect(validateSupplierReply(replyRaw({ proposedTotalXof: "-1" }), null).errors).toHaveLength(
      1,
    );
    expect(
      validateSupplierReply(replyRaw({ proposedTotalXof: "52000.5" }), null).errors,
    ).toHaveLength(1);
    expect(validateSupplierReply(replyRaw({ proposedTotalXof: "52000" }), null).errors).toEqual([]);
    expect(validateSupplierReply(replyRaw({ authorEmail: "mariam@" }), null).errors).toContain(
      "E-mail : adresse invalide.",
    );
  });

  it("REP-003 accepte une pièce jointe sur signature et refuse extension ou type divergents", () => {
    const accepted = validateSupplierAttachment({ name: "tarif.png", data: PNG });
    expect(accepted.errors).toEqual([]);
    expect(accepted.attachment?.mime).toBe("image/png");
    expect(accepted.attachment?.size).toBe(PNG.byteLength);

    const pdf = validateSupplierAttachment({ name: "offre.pdf", data: PDF });
    expect(pdf.errors).toEqual([]);
    expect(pdf.attachment?.mime).toBe("application/pdf");

    expect(validateSupplierAttachment({ name: "offre.png", data: PDF }).errors).toContain(
      "Pièce jointe : le contenu ne correspond pas à l'extension du fichier.",
    );
    expect(validateSupplierAttachment({ name: "script.exe", data: PDF }).errors).toContain(
      "Pièce jointe : le contenu ne correspond pas à l'extension du fichier.",
    );
    expect(
      validateSupplierAttachment({ name: "inconnu.bin", data: new Uint8Array([1, 2, 3, 4]) })
        .errors,
    ).toContain("Pièce jointe : formats acceptés PDF, PNG, JPEG et XLSX.");
  });

  it("REP-003 refuse une pièce de plus de 5 Mio et neutralise un chemin de fichier", () => {
    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    oversized.set(PDF.subarray(0, 4), 0);
    expect(validateSupplierAttachment({ name: "offre.pdf", data: oversized }).errors).toContain(
      "Pièce jointe : 5 Mio maximum.",
    );

    const path = validateSupplierAttachment({ name: "..\\secret\\offre.pdf", data: PDF });
    expect(path.errors).toEqual([]);
    expect(path.attachment?.name).toBe("offre.pdf");
  });
});
