import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  auditEvents,
  companySettings,
  emailAccounts,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  tenderInvitations,
  tenderQuoteLines,
  tenderQuotes,
  tenderRequestLines,
  tenderRequests,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedPurchasingTenant, type PurchasingTenant } from "@/test/purchases";
import { todayIsoDate } from "@/lib/dates";
import { saveEmailAccount } from "@/modules/exchange/queries";
import type { OutgoingMail, TransportFactory } from "@/modules/exchange/mailer";
import {
  awardTenderLine,
  cancelTender,
  createTenderDraft,
  deleteTenderDraft,
  generateTenderPurchaseOrders,
  getTender,
  rejectTenderLine,
  resendTenderInvitation,
  sendTender,
  updateTenderDraft,
} from "./queries";
import { getPublicTender, markTenderInvitationViewed, submitTenderQuote } from "./quote-queries";
import { hashTenderToken, tenderTokenExpiry, validateTenderDraft } from "./rules";
import { validateTenderQuote, type TenderQuoteRaw, type ValidatedTenderQuote } from "./quotes";

process.env.LEAN_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const APP_URL = "https://lean.test";
const TOKEN_PATTERN = /https:\/\/lean\.test\/cotations\/([A-Za-z0-9_-]{43})/;

interface Recorder {
  readonly factory: TransportFactory;
  readonly sent: OutgoingMail[];
  failTo: string | null;
}

function recorder(failTo: string | null = null): Recorder {
  const state: Recorder = {
    sent: [],
    failTo,
    factory: () => ({
      async verify() {},
      async send(message) {
        if (state.failTo && message.to === state.failTo) {
          throw new Error(`SMTP 550 boîte introuvable pour ${message.to}`);
        }
        state.sent.push(message);
        return { messageId: `<${state.sent.length}@lean.test>` };
      },
    }),
  };
  return state;
}

function tokenFrom(message: OutgoingMail | undefined): string {
  const match = message ? TOKEN_PATTERN.exec(message.text) : null;
  if (!match?.[1]) {
    throw new Error("Jeton de cotation absent du message.");
  }
  return match[1];
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface TenderTenant extends PurchasingTenant {
  readonly secondSupplierId: string;
  readonly supplierEmail: string;
  readonly secondSupplierEmail: string;
  readonly emailLessSupplierId: string;
}

let counter = 0;

async function setup(label: string, options: { mail?: boolean } = {}): Promise<TenderTenant> {
  counter += 1;
  const ids = await seedPurchasingTenant(db, `${label}-${counter}`);

  await db.insert(companySettings).values({ tenantId: ids.tenantId, legalName: "Lean SARL" });
  await db
    .update(partners)
    .set({ email: "sahel@test.local" })
    .where(eq(partners.id, ids.supplierId));

  const [second] = await db
    .insert(partners)
    .values({
      tenantId: ids.tenantId,
      code: "FOUR003",
      name: "Bamako Métal SARL",
      type: "company" as const,
      isSupplier: true,
      email: "bamako@test.local",
    })
    .returning({ id: partners.id });
  const [emailLess] = await db
    .insert(partners)
    .values({
      tenantId: ids.tenantId,
      code: "FOUR004",
      name: "Fournisseur sans e-mail",
      type: "company" as const,
      isSupplier: true,
    })
    .returning({ id: partners.id });
  if (!second || !emailLess) {
    throw new Error("Fournisseurs de test non créés.");
  }

  if (options.mail !== false) {
    await saveEmailAccount(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        name: "SMTP test",
        host: "smtp.lean.test",
        port: 587,
        security: "starttls",
        username: "achats@lean.test",
        fromName: "Lean Achats",
        fromAddress: "achats@lean.test",
        replyTo: null,
        active: true,
        passwordAction: "set",
        password: "secret-smtp-42",
      },
    });
  }

  return {
    ...ids,
    secondSupplierId: second.id,
    emailLessSupplierId: emailLess.id,
    supplierEmail: "sahel@test.local",
    secondSupplierEmail: "bamako@test.local",
  };
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

function draftData(
  ids: TenderTenant,
  overrides: Partial<{
    title: string;
    deadline: string;
    notes: string;
    lines: readonly { articleId: string; qty: unknown; requestedDate: unknown; note: unknown }[];
    supplierIds: readonly string[];
  }> = {},
) {
  return {
    title: "Réappro café vert",
    deadline: addDays(todayIsoDate(), 10),
    notes: "",
    lines: [
      {
        articleId: ids.productId,
        qty: "10",
        requestedDate: "",
        note: "",
      },
    ],
    supplierIds: [ids.supplierId],
    ...overrides,
  };
}

async function createDraft(ids: TenderTenant, overrides = {}): Promise<string> {
  const created = await createTenderDraft(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: draftData(ids, overrides),
  });
  return created.id;
}

async function pendingTenderIds(ids: TenderTenant, tenderId: string) {
  const [tender] = await db
    .select()
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, ids.tenantId), eq(tenderRequests.id, tenderId)))
    .limit(1);
  const lines = await db
    .select()
    .from(tenderRequestLines)
    .where(
      and(eq(tenderRequestLines.tenantId, ids.tenantId), eq(tenderRequestLines.tenderId, tenderId)),
    )
    .orderBy(asc(tenderRequestLines.lineNumber));
  const invitations = await db
    .select()
    .from(tenderInvitations)
    .where(
      and(eq(tenderInvitations.tenantId, ids.tenantId), eq(tenderInvitations.tenderId, tenderId)),
    );
  return { tender, lines, invitations };
}

async function sendTenderNow(ids: TenderTenant, tenderId: string, transport: Recorder) {
  return sendTender(
    db,
    { tenantId: ids.tenantId, actorUserId: ids.userId, tenderId, appUrl: APP_URL },
    transport.factory,
  );
}

async function sendWithTokens(
  ids: TenderTenant,
  tenderId: string,
  transport: Recorder,
): Promise<Map<string, string>> {
  await sendTenderNow(ids, tenderId, transport);
  const { invitations } = await pendingTenderIds(ids, tenderId);
  const tokens = new Map<string, string>();
  for (const invitation of invitations) {
    const message = transport.sent.find((mail) => mail.to === invitation.recipientEmail);
    if (!message) {
      continue;
    }
    tokens.set(invitation.supplierId, tokenFrom(message));
  }
  return tokens;
}

function quoteRaw(
  lines: readonly { tenderLineId: string; qty: unknown; unitPriceXof: unknown }[],
  overrides: Partial<TenderQuoteRaw> = {},
): TenderQuoteRaw {
  return {
    authorName: "Mariam Traoré",
    authorEmail: "mariam@sahel.test",
    leadTimeDays: "5",
    comment: "",
    declined: false,
    honeypot: "",
    lines,
    ...overrides,
  };
}

function requireQuote(result: { quote: ValidatedTenderQuote | null; errors: string[] }) {
  if (!result.quote) {
    throw new Error(`Cotation de test invalide : ${result.errors.join(", ")}`);
  }
  return result.quote;
}

async function submitOk(ids: TenderTenant, token: string, raw: TenderQuoteRaw) {
  return submitTenderQuote(db, { token, data: raw });
}

describe("SCM-001 — brouillon de demande de cotation", () => {
  it("refuse un intitulé vide, une échéance passée, aucune ligne et aucun fournisseur", () => {
    const today = "2026-10-29";
    const result = validateTenderDraft(
      { title: "", deadline: "2026-10-28", notes: "", lines: [], supplierIds: [] },
      today,
    );
    expect(result.draft).toBeNull();
    expect(result.errors.join("\n")).toMatch(/Intitulé/);
    expect(result.errors.join("\n")).toMatch(/Échéance/);
    expect(result.errors.join("\n")).toMatch(/au moins une ligne/);
    expect(result.errors.join("\n")).toMatch(/au moins un fournisseur/);
  });

  it("refuse une quantité nulle et un fournisseur invité deux fois", () => {
    const supplierId = "11111111-1111-4111-8111-111111111111";
    const articleId = "22222222-2222-4222-8222-222222222222";
    const result = validateTenderDraft(
      {
        title: "Demande",
        deadline: "2026-11-10",
        notes: "",
        lines: [{ articleId, qty: "0", requestedDate: "", note: "" }],
        supplierIds: [supplierId, supplierId],
      },
      "2026-10-29",
    );
    expect(result.draft).toBeNull();
    expect(result.errors.join("\n")).toMatch(/quantité/i);
    expect(result.errors.join("\n")).toMatch(/deux fois/);
  });

  it("refuse un article inactif, un article non achetable, un tiers sans rôle fournisseur et un fournisseur sans e-mail", async () => {
    const ids = await setup("scm001-refus");

    await expect(
      createTenderDraft(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, {
          lines: [{ articleId: ids.inactiveProductId, qty: "1", requestedDate: "", note: "" }],
        }),
      }),
    ).rejects.toThrow(/inactif ou non achetable/);

    await expect(
      createTenderDraft(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, {
          lines: [{ articleId: ids.notPurchasableId, qty: "1", requestedDate: "", note: "" }],
        }),
      }),
    ).rejects.toThrow(/inactif ou non achetable/);

    await expect(
      createTenderDraft(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, { supplierIds: [ids.customerId] }),
      }),
    ).rejects.toThrow(/inactif ou sans rôle fournisseur/);

    await expect(
      createTenderDraft(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        data: draftData(ids, { supplierIds: [ids.emailLessSupplierId] }),
      }),
    ).rejects.toThrow(/sans adresse e-mail valide/);
  });

  it("crée un brouillon sans numéro, le modifie puis le supprime, avec audit cloisonné", async () => {
    const ids = await setup("scm001-cycle");
    const tenderId = await createDraft(ids);

    const created = await pendingTenderIds(ids, tenderId);
    expect(created.tender?.number).toBeNull();
    expect(created.tender?.status).toBe("draft");
    expect(created.lines).toHaveLength(1);
    expect(created.invitations).toHaveLength(1);
    expect(created.invitations[0]?.recipientEmail).toBe(ids.supplierEmail);

    const createAudit = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityId, tenderId)));
    expect(createAudit.map((row) => row.action)).toContain("tender.create");

    await updateTenderDraft(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      data: draftData(ids, {
        title: "Réappro café et sucre",
        lines: [
          { articleId: ids.productId, qty: "10", requestedDate: "", note: "Torréfié" },
          { articleId: ids.secondProductId, qty: "5", requestedDate: "", note: "" },
        ],
        supplierIds: [ids.supplierId, ids.secondSupplierId],
      }),
    });
    const updated = await pendingTenderIds(ids, tenderId);
    expect(updated.tender?.title).toBe("Réappro café et sucre");
    expect(updated.lines.map((line) => line.name)).toEqual(["Café vert", "Sucre roux"]);
    expect(updated.invitations).toHaveLength(2);

    await deleteTenderDraft(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
    });
    const gone = await getTender(db, { tenantId: ids.tenantId, tenderId });
    expect(gone).toBeNull();
  });
});

describe("SCM-002 — envoi, jetons et annulation", () => {
  it("exige une raison sociale et un compte d'envoi actif", async () => {
    const noMail = await setup("scm002-sans-compte", { mail: false });
    const tenderId = await createDraft(noMail);
    await expect(sendTenderNow(noMail, tenderId, recorder())).rejects.toThrow(/Compte d'envoi/);

    const noCompany = await setup("scm002-sans-societe");
    await db.delete(companySettings).where(eq(companySettings.tenantId, noCompany.tenantId));
    const secondTender = await createDraft(noCompany);
    await expect(sendTenderNow(noCompany, secondTender, recorder())).rejects.toThrow(
      /raison sociale/,
    );

    const inactive = await setup("scm002-compte-inactif");
    await db
      .update(emailAccounts)
      .set({ active: false })
      .where(eq(emailAccounts.tenantId, inactive.tenantId));
    const thirdTender = await createDraft(inactive);
    await expect(sendTenderNow(inactive, thirdTender, recorder())).rejects.toThrow(
      /Compte d'envoi absent ou inactif/,
    );
  });

  it("numérote DAO, fige la demande, stocke une empreinte et envoie un lien personnel", async () => {
    const ids = await setup("scm002-envoi");
    const tenderId = await createDraft(ids, {
      supplierIds: [ids.supplierId, ids.secondSupplierId],
    });
    const transport = recorder();
    const result = await sendTenderNow(ids, tenderId, transport);

    expect(result.number).toMatch(/^DAO-\d{4}-\d{4}$/);
    expect(result.delivered).toBe(2);
    expect(result.failures).toHaveLength(0);

    const { tender, invitations } = await pendingTenderIds(ids, tenderId);
    expect(tender?.status).toBe("open");
    expect(tender?.sentAt).toBeInstanceOf(Date);
    expect(invitations).toHaveLength(2);

    const token = tokenFrom(transport.sent[0]);
    for (const invitation of invitations) {
      expect(invitation.status).toBe("sent");
      expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(invitation.tokenExpiresAt?.toISOString()).toBe(
        tenderTokenExpiry(tender!.deadline).toISOString(),
      );
      expect(invitation.tokenHash).not.toBe(token);
    }
    expect(invitations.some((row) => row.tokenHash === hashTenderToken(token))).toBe(true);

    const mail = transport.sent[0];
    expect(mail?.subject).toContain(result.number);
    expect(mail?.text).toContain("Ce lien est personnel");
    expect(mail?.html).toContain("/cotations/");

    const counts = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, ids.tenantId));
    const actions = counts.map((row) => row.action);
    expect(actions).toContain("tender.send");
    expect(actions.filter((action) => action === "tender.invitation.send")).toHaveLength(2);

    await expect(sendTenderNow(ids, tenderId, recorder())).rejects.toThrow(/déjà été envoyée/);
  });

  it("isole l'échec d'un destinataire : aucun lien actif, erreur journalisée, les autres reçoivent", async () => {
    const ids = await setup("scm002-echec");
    const tenderId = await createDraft(ids, {
      supplierIds: [ids.supplierId, ids.secondSupplierId],
    });
    const transport = recorder(ids.secondSupplierEmail);
    const result = await sendTenderNow(ids, tenderId, transport);

    expect(result.delivered).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.supplierName).toBe("Bamako Métal SARL");

    const { invitations } = await pendingTenderIds(ids, tenderId);
    const failed = invitations.find((row) => row.recipientEmail === ids.secondSupplierEmail);
    const sent = invitations.find((row) => row.recipientEmail === ids.supplierEmail);
    expect(failed?.tokenHash).toBeNull();
    expect(failed?.tokenExpiresAt).toBeNull();
    expect(failed?.errorMessage).toContain("boîte introuvable");
    expect(sent?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const failureAudit = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "tender.invitation.send"),
        ),
      );
    expect(
      failureAudit.some((row) => (row.details as { status?: string })?.status === "failed"),
    ).toBe(true);
  });

  it("fait tourner le jeton au renvoi : l'ancien lien devient inerte", async () => {
    const ids = await setup("scm002-renvoi");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const oldToken = tokens.get(ids.supplierId);
    if (!oldToken) {
      throw new Error("Jeton initial absent.");
    }
    expect(await getPublicTender(db, oldToken)).not.toBeNull();

    const { invitations } = await pendingTenderIds(ids, tenderId);
    const invitation = invitations[0];
    if (!invitation) {
      throw new Error("Invitation absente.");
    }
    const resend = recorder();
    await resendTenderInvitation(
      db,
      {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        invitationId: invitation.id,
        appUrl: APP_URL,
      },
      resend.factory,
    );

    const newToken = tokenFrom(resend.sent[0]);
    expect(newToken).not.toBe(oldToken);
    expect(await getPublicTender(db, oldToken)).toBeNull();
    expect(await getPublicTender(db, newToken)).not.toBeNull();
  });

  it("annule une demande ouverte, révoque les liens et exige un motif", async () => {
    const ids = await setup("scm002-annulation");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId);
    if (!token) {
      throw new Error("Jeton absent.");
    }

    await expect(
      cancelTender(db, { tenantId: ids.tenantId, actorUserId: ids.userId, tenderId, reason: "  " }),
    ).rejects.toThrow(/Motif d'annulation/);

    await cancelTender(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      reason: "Besoin couvert par le stock.",
    });

    const { tender, invitations } = await pendingTenderIds(ids, tenderId);
    expect(tender?.status).toBe("cancelled");
    expect(tender?.cancelReason).toBe("Besoin couvert par le stock.");
    expect(invitations.every((row) => row.tokenHash === null)).toBe(true);
    expect(await getPublicTender(db, token)).toBeNull();

    await expect(
      cancelTender(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        reason: "Deuxième annulation",
      }),
    ).rejects.toThrow(/Seule une demande ouverte/);
  });
});

describe("SCM-003 — page publique de cotation", () => {
  it("répond de façon neutre à un jeton inconnu, mal formé, expiré ou rattaché à une demande annulée", async () => {
    const ids = await setup("scm003-jetons");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId);
    if (!token) {
      throw new Error("Jeton absent.");
    }

    expect(await getPublicTender(db, "trop-court")).toBeNull();
    expect(await getPublicTender(db, "A".repeat(43))).toBeNull();

    const { invitations } = await pendingTenderIds(ids, tenderId);
    const invitation = invitations[0]!;
    await db
      .update(tenderInvitations)
      .set({ tokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(tenderInvitations.id, invitation.id));
    expect(await getPublicTender(db, token)).toBeNull();

    await db
      .update(tenderInvitations)
      .set({ tokenExpiresAt: tenderTokenExpiry(addDays(todayIsoDate(), 10)) })
      .where(eq(tenderInvitations.id, invitation.id));
    expect(await getPublicTender(db, token)).not.toBeNull();

    await cancelTender(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      reason: "Annulée pour le test.",
    });
    expect(await getPublicTender(db, token)).toBeNull();
  });

  it("refuse la cotation après l'échéance du jour", async () => {
    const ids = await setup("scm003-echeance");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const { lines } = await pendingTenderIds(ids, tenderId);

    await db
      .update(tenderRequests)
      .set({ deadline: addDays(todayIsoDate(), -1) })
      .where(eq(tenderRequests.id, tenderId));

    await db
      .update(tenderInvitations)
      .set({ tokenExpiresAt: tenderTokenExpiry(addDays(todayIsoDate(), -1)) })
      .where(eq(tenderInvitations.tokenHash, hashTenderToken(token)));

    expect(await getPublicTender(db, token)).toBeNull();
    await expect(
      submitOk(
        ids,
        token,
        quoteRaw([{ tenderLineId: lines[0]!.id, qty: "1", unitPriceXof: 1000 }]),
      ),
    ).rejects.toThrow(/plus actif/);
  });

  it("n'expose que le nécessaire et n'accepte que les lignes de la demande liée", async () => {
    const ids = await setup("scm003-minimal");
    const tenderId = await createDraft(ids, {
      lines: [
        {
          articleId: ids.productId,
          qty: "10",
          requestedDate: addDays(todayIsoDate(), 5),
          note: "",
        },
      ],
    });
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const publicContext = await getPublicTender(db, token);
    if (!publicContext) {
      throw new Error("Contexte public absent.");
    }

    expect(publicContext.companyName).toBe("Lean SARL");
    expect(publicContext.number).toMatch(/^DAO-/);
    expect(publicContext.supplierName).toBe("Sahel Négoce SARL");
    expect(publicContext.lines).toHaveLength(1);
    expect(publicContext.lines[0]?.name).toBe("Café vert");
    expect(publicContext.lines[0]?.qty).toBe("10.000000");
    expect(publicContext.latestQuote).toBeNull();
    expect(publicContext.revisionCount).toBe(0);

    const other = await setup("scm003-autre");
    const otherTender = await createDraft(other);
    const otherTransport = recorder();
    const otherTokens = await sendWithTokens(other, otherTender, otherTransport);
    const otherToken = otherTokens.get(other.supplierId)!;
    const otherContext = await getPublicTender(db, otherToken);
    const foreignLineId = otherContext?.lines[0]?.id;
    if (!foreignLineId) {
      throw new Error("Ligne distante absente.");
    }

    const lines = publicContext.lines;
    const raw = quoteRaw([
      { tenderLineId: lines[0]!.id, qty: "1", unitPriceXof: 1000 },
      { tenderLineId: foreignLineId, qty: "1", unitPriceXof: 500 },
    ]);
    const validation = validateTenderQuote(raw, lines);
    expect(validation.quote).toBeNull();
    expect(validation.errors.join("\n")).toMatch(/référence inconnue/);
  });

  it("horodate la première consultation une seule fois", async () => {
    const ids = await setup("scm003-consultation");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const publicContext = await getPublicTender(db, tokens.get(ids.supplierId)!);
    if (!publicContext) {
      throw new Error("Contexte public absent.");
    }
    await markTenderInvitationViewed(db, publicContext);
    const { invitations } = await pendingTenderIds(ids, tenderId);
    const first = invitations[0]?.firstViewedAt;
    expect(first).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await markTenderInvitationViewed(db, publicContext);
    const again = (await pendingTenderIds(ids, tenderId)).invitations[0]?.firstViewedAt;
    expect(again?.toISOString()).toBe(first?.toISOString());
  });
});

describe("SCM-004 — cotation fournisseur", () => {
  const requested = [
    { id: "11111111-1111-4111-8111-111111111111", lineNumber: 1, qty: "10.000000" },
    { id: "22222222-2222-4222-8222-222222222222", lineNumber: 2, qty: "5.000000" },
  ];

  it("refuse le champ piège, la quantité excessive, le prix manquant et le refus non motivé", () => {
    expect(
      validateTenderQuote(
        quoteRaw([{ tenderLineId: requested[0]!.id, qty: "10", unitPriceXof: 1000 }], {
          honeypot: "robot",
        }),
        requested,
      ).quote,
    ).toBeNull();

    const excessive = validateTenderQuote(
      quoteRaw([
        { tenderLineId: requested[0]!.id, qty: "11", unitPriceXof: 1000 },
        { tenderLineId: requested[1]!.id, qty: "0", unitPriceXof: "" },
      ]),
      requested,
    );
    expect(excessive.errors.join("\n")).toMatch(/supérieure à la quantité demandée/);

    const noPrice = validateTenderQuote(
      quoteRaw([
        { tenderLineId: requested[0]!.id, qty: "10", unitPriceXof: "" },
        { tenderLineId: requested[1]!.id, qty: "0", unitPriceXof: "" },
      ]),
      requested,
    );
    expect(noPrice.errors.join("\n")).toMatch(/Prix unitaire : obligatoire/);

    const refused = validateTenderQuote(
      quoteRaw(
        [
          { tenderLineId: requested[0]!.id, qty: "0", unitPriceXof: "" },
          { tenderLineId: requested[1]!.id, qty: "0", unitPriceXof: "" },
        ],
        { declined: true, comment: "" },
      ),
      requested,
    );
    expect(refused.errors.join("\n")).toMatch(/précisez le motif du refus/);

    const noneOffered = validateTenderQuote(
      quoteRaw([
        { tenderLineId: requested[0]!.id, qty: "0", unitPriceXof: "" },
        { tenderLineId: requested[1]!.id, qty: "0", unitPriceXof: "" },
      ]),
      requested,
    );
    expect(noneOffered.errors.join("\n")).toMatch(/au moins une ligne proposée/);
  });

  it("calcule les totaux HALF_UP et ignore les lignes à quantité nulle", () => {
    const valid = requireQuote(
      validateTenderQuote(
        quoteRaw([
          { tenderLineId: requested[0]!.id, qty: "3.333333", unitPriceXof: 1000 },
          { tenderLineId: requested[1]!.id, qty: "0", unitPriceXof: "" },
        ]),
        requested,
      ),
    );
    expect(valid.lines).toHaveLength(2);
    expect(valid.lines[0]?.lineTotalXof).toBe(3333);
    expect(valid.lines[1]?.unitPriceXof).toBe(0);
    expect(valid.totalXof).toBe(3333);
  });

  it("dépose des révisions append-only, seule la dernière faisant foi, avec audit sans acteur", async () => {
    const ids = await setup("scm004-revisions");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const { lines } = await pendingTenderIds(ids, tenderId);
    const lineId = lines[0]!.id;

    const first = await submitOk(
      ids,
      token,
      quoteRaw([{ tenderLineId: lineId, qty: "10", unitPriceXof: 1200 }]),
    );
    expect(first.revision).toBe(1);

    const second = await submitOk(
      ids,
      token,
      quoteRaw([{ tenderLineId: lineId, qty: "8", unitPriceXof: 1100 }], { leadTimeDays: "7" }),
    );
    expect(second.revision).toBe(2);

    const stored = await db
      .select({ revision: tenderQuotes.revision, totalXof: tenderQuotes.totalXof })
      .from(tenderQuotes)
      .where(eq(tenderQuotes.tenantId, ids.tenantId))
      .orderBy(asc(tenderQuotes.revision));
    expect(stored.map((row) => row.revision)).toEqual([1, 2]);
    expect(stored[0]?.totalXof).toBe(12000);
    expect(stored[1]?.totalXof).toBe(8800);

    const publicContext = await getPublicTender(db, token);
    expect(publicContext?.latestQuote?.revision).toBe(2);
    expect(publicContext?.latestQuote?.leadTimeDays).toBe(7);
    expect(publicContext?.revisionCount).toBe(2);

    const { invitations } = await pendingTenderIds(ids, tenderId);
    expect(invitations[0]?.status).toBe("quoted");
    expect(invitations[0]?.firstViewedAt).toBeInstanceOf(Date);

    const audit = await db
      .select({ actorUserId: auditEvents.actorUserId, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "tender.quote.submit")),
      );
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.actorUserId === null)).toBe(true);
    expect((audit[1]?.details as { offeredLines?: number[] })?.offeredLines).toEqual([1]);
  });

  it("plafonne à dix dépôts par fournisseur", async () => {
    const ids = await setup("scm004-plafond");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const { lines } = await pendingTenderIds(ids, tenderId);
    const lineId = lines[0]!.id;

    for (let revision = 1; revision <= 10; revision += 1) {
      const result = await submitOk(
        ids,
        token,
        quoteRaw([{ tenderLineId: lineId, qty: "10", unitPriceXof: 1000 + revision }]),
      );
      expect(result.revision).toBe(revision);
    }

    await expect(
      submitOk(ids, token, quoteRaw([{ tenderLineId: lineId, qty: "10", unitPriceXof: 900 }])),
    ).rejects.toThrow(/10 dépôts maximum/);
  });

  it("enregistre un refus global motivé et l'exclut des offres", async () => {
    const ids = await setup("scm004-refus");
    const tenderId = await createDraft(ids);
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const { lines } = await pendingTenderIds(ids, tenderId);

    const result = await submitOk(
      ids,
      token,
      quoteRaw([{ tenderLineId: lines[0]!.id, qty: "0", unitPriceXof: "" }], {
        declined: true,
        comment: "Rupture de stock jusqu'en janvier.",
      }),
    );
    expect(result.declined).toBe(true);

    const { invitations } = await pendingTenderIds(ids, tenderId);
    expect(invitations[0]?.status).toBe("declined");

    const detail = await getTender(db, { tenantId: ids.tenantId, tenderId });
    expect(detail?.invitations[0]?.latestQuote?.declined).toBe(true);

    const [quote] = await db
      .select({ id: tenderQuotes.id })
      .from(tenderQuotes)
      .where(eq(tenderQuotes.tenantId, ids.tenantId));
    const quoteLine = await db
      .select({ id: tenderQuoteLines.id })
      .from(tenderQuoteLines)
      .where(eq(tenderQuoteLines.quoteId, quote!.id));
    expect(quoteLine).toHaveLength(0);

    await expect(
      awardTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        quoteLineId: "00000000-0000-4000-8000-000000000000",
        motive: "",
      }),
    ).rejects.toThrow(/introuvable/);
  });
});

interface TenderWithQuotes {
  readonly ids: TenderTenant;
  readonly tenderId: string;
  readonly lineAId: string;
  readonly lineBId: string;
  readonly supplierAQuoteLineA: string;
  readonly supplierAQuoteLineB: string;
  readonly supplierBQuoteLineA: string;
  readonly supplierBQuoteLineB: string | null;
  readonly tokenA: string;
  readonly tokenB: string;
}

async function tenderWithTwoQuotes(label: string): Promise<TenderWithQuotes> {
  const ids = await setup(label);
  const tenderId = await createDraft(ids, {
    lines: [
      { articleId: ids.productId, qty: "10", requestedDate: "", note: "" },
      { articleId: ids.secondProductId, qty: "5", requestedDate: "", note: "" },
    ],
    supplierIds: [ids.supplierId, ids.secondSupplierId],
  });
  const transport = recorder();
  const tokens = await sendWithTokens(ids, tenderId, transport);
  const tokenA = tokens.get(ids.supplierId)!;
  const tokenB = tokens.get(ids.secondSupplierId)!;
  const { lines } = await pendingTenderIds(ids, tenderId);
  const lineAId = lines[0]!.id;
  const lineBId = lines[1]!.id;

  await submitOk(
    ids,
    tokenA,
    quoteRaw(
      [
        { tenderLineId: lineAId, qty: "10", unitPriceXof: 1000 },
        { tenderLineId: lineBId, qty: "5", unitPriceXof: 450 },
      ],
      { leadTimeDays: "7" },
    ),
  );
  await submitOk(
    ids,
    tokenB,
    quoteRaw(
      [
        { tenderLineId: lineAId, qty: "10", unitPriceXof: 900 },
        { tenderLineId: lineBId, qty: "0", unitPriceXof: "" },
      ],
      { leadTimeDays: "10" },
    ),
  );

  const quotes = await db
    .select({ id: tenderQuotes.id, supplierId: tenderQuotes.supplierId })
    .from(tenderQuotes)
    .where(eq(tenderQuotes.tenantId, ids.tenantId));
  const quoteA = quotes.find((row) => row.supplierId === ids.supplierId);
  const quoteB = quotes.find((row) => row.supplierId === ids.secondSupplierId);
  if (!quoteA || !quoteB) {
    throw new Error("Cotations de test absentes.");
  }
  const quoteLines = await db
    .select({
      id: tenderQuoteLines.id,
      quoteId: tenderQuoteLines.quoteId,
      tenderLineId: tenderQuoteLines.tenderLineId,
      proposedQty: tenderQuoteLines.proposedQty,
    })
    .from(tenderQuoteLines)
    .where(eq(tenderQuoteLines.tenantId, ids.tenantId));

  const supplierAQuoteLineA = quoteLines.find(
    (row) => row.quoteId === quoteA.id && row.tenderLineId === lineAId,
  )?.id;
  const supplierAQuoteLineB = quoteLines.find(
    (row) => row.quoteId === quoteA.id && row.tenderLineId === lineBId,
  )?.id;
  const supplierBQuoteLineA = quoteLines.find(
    (row) => row.quoteId === quoteB.id && row.tenderLineId === lineAId,
  )?.id;
  const bLineB = quoteLines.find(
    (row) => row.quoteId === quoteB.id && row.tenderLineId === lineBId,
  );
  if (!supplierAQuoteLineA || !supplierAQuoteLineB || !supplierBQuoteLineA) {
    throw new Error("Offres de test absentes.");
  }

  return {
    ids,
    tenderId,
    lineAId,
    lineBId,
    supplierAQuoteLineA,
    supplierAQuoteLineB,
    supplierBQuoteLineA,
    supplierBQuoteLineB: bLineB?.id ?? null,
    tokenA,
    tokenB,
  };
}

describe("SCM-005 — comparaison et attribution", () => {
  it("classe les offres par prix, délai puis dépôt", async () => {
    const fixture = await tenderWithTwoQuotes("scm005-tri");
    const detail = await getTender(db, {
      tenantId: fixture.ids.tenantId,
      tenderId: fixture.tenderId,
    });
    const lineA = detail?.lines[0];
    const offers = detail?.invitations
      .flatMap((invitation) => (invitation.latestQuote ? [invitation.latestQuote] : []))
      .flatMap((quote) =>
        quote.lines
          .filter((line) => line.tenderLineId === lineA?.id && line.proposedQty !== "0.000000")
          .map((line) => ({ quote, line })),
      );
    expect(offers).toHaveLength(2);
    const sorted = offers?.sort((left, right) => left.line.unitPriceXof - right.line.unitPriceXof);
    expect(sorted?.[0]?.line.unitPriceXof).toBe(900);
    expect(sorted?.[1]?.line.unitPriceXof).toBe(1000);
  });

  it("exige un motif au-dessus du meilleur prix, fige l'attribution et attribue sans motif ailleurs", async () => {
    const fixture = await tenderWithTwoQuotes("scm005-motif");
    const { ids, tenderId } = fixture;

    await expect(
      awardTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        quoteLineId: fixture.supplierAQuoteLineA,
        motive: "",
      }),
    ).rejects.toThrow(/Motif : obligatoire/);

    const above = await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: fixture.supplierAQuoteLineA,
      motive: "Livraison à 7 jours contre 10.",
    });
    expect(above.tenderStatus).toBe("open");

    const onlyOffer = await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: fixture.supplierAQuoteLineB,
      motive: "",
    });
    expect(onlyOffer.tenderStatus).toBe("awarded");
  });

  it("refuse une ligne déjà attribuée", async () => {
    const fixture = await tenderWithTwoQuotes("scm005-garde");
    const { ids, tenderId } = fixture;

    await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: fixture.supplierBQuoteLineA,
      motive: "",
    });
    await expect(
      awardTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        quoteLineId: fixture.supplierAQuoteLineA,
        motive: "Meilleur délai.",
      }),
    ).rejects.toThrow(/déjà attribuée/);
  });

  it("refuse d'attribuer une révision périmée", async () => {
    const fixture = await tenderWithTwoQuotes("scm005-revision");
    const { ids, tenderId } = fixture;

    const revisionTwo = await submitOk(
      ids,
      fixture.tokenA,
      quoteRaw(
        [
          { tenderLineId: fixture.lineAId, qty: "10", unitPriceXof: 950 },
          { tenderLineId: fixture.lineBId, qty: "5", unitPriceXof: 440 },
        ],
        { leadTimeDays: "6" },
      ),
    );
    expect(revisionTwo.revision).toBe(2);

    await expect(
      awardTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        quoteLineId: fixture.supplierAQuoteLineA,
        motive: "Prix.",
      }),
    ).rejects.toThrow(/révision 2/);
  });

  it("écarte une ligne, refuse d'attribuer une ligne écartée et termine la demande", async () => {
    const ids = await setup("scm005-ecarter");
    const tenderId = await createDraft(ids, {
      lines: [
        { articleId: ids.productId, qty: "10", requestedDate: "", note: "" },
        { articleId: ids.secondProductId, qty: "5", requestedDate: "", note: "" },
      ],
    });
    const transport = recorder();
    const tokens = await sendWithTokens(ids, tenderId, transport);
    const token = tokens.get(ids.supplierId)!;
    const { lines } = await pendingTenderIds(ids, tenderId);

    await submitOk(
      ids,
      token,
      quoteRaw([
        { tenderLineId: lines[0]!.id, qty: "10", unitPriceXof: 1000 },
        { tenderLineId: lines[1]!.id, qty: "5", unitPriceXof: 450 },
      ]),
    );
    const [quote] = await db
      .select({ id: tenderQuotes.id })
      .from(tenderQuotes)
      .where(eq(tenderQuotes.tenantId, ids.tenantId));
    const quoteLines = await db
      .select({ id: tenderQuoteLines.id, tenderLineId: tenderQuoteLines.tenderLineId })
      .from(tenderQuoteLines)
      .where(eq(tenderQuoteLines.quoteId, quote!.id));
    const lineBQuote = quoteLines.find((row) => row.tenderLineId === lines[1]!.id);
    if (!lineBQuote) {
      throw new Error("Offre ligne 2 absente.");
    }

    await rejectTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      tenderLineId: lines[1]!.id,
    });
    await expect(
      rejectTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        tenderLineId: lines[1]!.id,
      }),
    ).rejects.toThrow(/déjà écartée/);
    await expect(
      awardTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        quoteLineId: lineBQuote.id,
        motive: "",
      }),
    ).rejects.toThrow(/écartée/);

    const result = await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: quoteLines.find((row) => row.tenderLineId === lines[0]!.id)!.id,
      motive: "",
    });
    expect(result.tenderStatus).toBe("awarded");

    const detail = await getTender(db, { tenantId: ids.tenantId, tenderId });
    expect(detail?.tender.status).toBe("awarded");
    expect(detail?.tender.awardedAt).toBeInstanceOf(Date);

    await expect(
      cancelTender(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        reason: "Trop tard.",
      }),
    ).rejects.toThrow(/Seule une demande ouverte/);
    await expect(
      rejectTenderLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
        tenderLineId: lines[0]!.id,
      }),
    ).rejects.toThrow(/plus ouverte/);
  });

  it("cloisonne les attributions par espace de travail", async () => {
    const fixture = await tenderWithTwoQuotes("scm005-cloison");
    const other = await setup("scm005-cloison-autre");
    const otherTender = await createDraft(other);
    await sendTenderNow(other, otherTender, recorder());
    await expect(
      awardTenderLine(db, {
        tenantId: other.tenantId,
        actorUserId: other.userId,
        tenderId: otherTender,
        quoteLineId: fixture.supplierBQuoteLineA,
        motive: "",
      }),
    ).rejects.toThrow(/Offre introuvable/);
  });
});

describe("SCM-006 — génération des commandes fournisseur", () => {
  it("refuse une demande non attribuée ou déjà générée", async () => {
    const ids = await setup("scm006-garde");
    const tenderId = await createDraft(ids);
    await expect(
      generateTenderPurchaseOrders(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
      }),
    ).rejects.toThrow(/entièrement attribuée/);
  });

  it("crée une commande brouillon par fournisseur retenu, une seule fois", async () => {
    const fixture = await tenderWithTwoQuotes("scm006-generation");
    const { ids, tenderId } = fixture;

    await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: fixture.supplierBQuoteLineA,
      motive: "",
    });
    await awardTenderLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
      quoteLineId: fixture.supplierAQuoteLineB,
      motive: "",
    });

    const awarded = await getTender(db, { tenantId: ids.tenantId, tenderId });
    expect(awarded?.tender.status).toBe("awarded");

    const result = await generateTenderPurchaseOrders(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      tenderId,
    });
    expect(result.orderIds).toHaveLength(2);

    const orders = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, ids.tenantId))
      .orderBy(asc(purchaseOrders.createdAt));
    expect(orders).toHaveLength(2);
    const number = awarded?.tender.number;
    for (const order of orders) {
      expect(order.status).toBe("draft");
      expect(order.tenderId).toBe(tenderId);
      expect(order.externalReference).toBe(number);
      expect(order.notes).toBe(`Attribution ${number}`);
      expect(order.receiptState).toBe("not_received");
    }

    const supplierAOrder = orders.find((order) => order.supplierId === ids.supplierId);
    const supplierBOrder = orders.find((order) => order.supplierId === ids.secondSupplierId);
    expect(supplierAOrder?.expectedReceiptDate).toBe(addDays(todayIsoDate(), 7));
    expect(supplierBOrder?.expectedReceiptDate).toBe(addDays(todayIsoDate(), 10));
    expect(supplierAOrder?.exTaxTotal).toBe(450 * 5);
    expect(supplierBOrder?.exTaxTotal).toBe(900 * 10);

    const bLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, supplierBOrder!.id));
    expect(bLines).toHaveLength(1);
    expect(bLines[0]?.qty).toBe("10.000000");
    expect(bLines[0]?.unitPriceXof).toBe(900);
    expect(bLines[0]?.lineTotalXof).toBe(9000);

    const refreshed = await getTender(db, { tenantId: ids.tenantId, tenderId });
    expect(refreshed?.tender.ordersCreatedAt).toBeInstanceOf(Date);
    expect(refreshed?.purchaseOrders).toHaveLength(2);

    const audit = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityId, tenderId)));
    expect(audit.map((row) => row.action)).toContain("tender.orders.create");

    await expect(
      generateTenderPurchaseOrders(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        tenderId,
      }),
    ).rejects.toThrow(/déjà été créées/);
  });
});
