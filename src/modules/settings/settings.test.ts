import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  companySettings,
  partnerContacts,
  partners,
  tenants,
  users,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant } from "@/test/sales";
import { createSalesOrder, getSalesOrder } from "@/modules/sales/queries";
import { can } from "@/modules/identity/permissions";
import {
  createPartnerContact,
  getPartnerContact,
  listPartnerContacts,
  updatePartnerContact,
} from "./contacts";
import {
  clearCompanyLogo,
  getCompanyLogo,
  getCompanySettings,
  setCompanyLogo,
  updateCompanySettings,
} from "./queries";
import {
  MAX_LOGO_BYTES,
  validateCompanyProfile,
  validateLogo,
  validatePartnerContact,
  type CompanyProfileData,
  type PartnerContactData,
} from "./validation";

let context: TestDatabase;
let db: Database;
let userSequence = 0;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

async function makeTenant(slug: string): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug, name: `Espace ${slug}` })
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Tenant non créé.");
  }
  return row.id;
}

async function makeUser(tenantId: string): Promise<string> {
  userSequence += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `settings-${userSequence}@test.local`,
      name: "Awa Paramètres",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("Utilisateur non créé.");
  }
  void tenantId;
  return row.id;
}

async function makePartner(tenantId: string, code: string): Promise<string> {
  const [row] = await db
    .insert(partners)
    .values({
      tenantId,
      code,
      name: `Tiers ${code}`,
      type: "company",
      isCustomer: true,
    })
    .returning({ id: partners.id });
  if (!row) {
    throw new Error("Tiers non créé.");
  }
  return row.id;
}

function profile(overrides: Partial<CompanyProfileData> = {}): CompanyProfileData {
  return {
    legalName: "Sahel Distribution SARL",
    legalForm: "SARL",
    capitalXof: 10_000_000,
    taxId: "CI123456789",
    rccm: "CI-ABJ-2026-B-12345",
    addressLine: "Zone industrielle de Yopougon",
    city: "Abidjan",
    postalCode: "00225",
    countryCode: "CI",
    email: "contact@sahel.example",
    phone: "+225 27 00 00 00 00",
    website: "https://sahel.example",
    invoiceFooter: "Paiement par virement au compte indiqué.",
    paymentTermDays: 30,
    defaultIncoterm: "FOB",
    bankName: "Banque Atlantique",
    bankAccountHolder: "Sahel Distribution SARL",
    bankAccountNumber: "CI930010000000000000",
    bankSwift: "ATLNCIAB",
    ...overrides,
  };
}

function contact(overrides: Partial<PartnerContactData> = {}): PartnerContactData {
  return {
    fullName: "Aminata Koné",
    jobTitle: "Responsable achats",
    email: "aminata.kone@sahel.example",
    phone: "+225 07 00 00 00 00",
    isPrimary: false,
    active: true,
    ...overrides,
  };
}

function pngBytes(size = 24): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

describe("ORG-001 — fiche entreprise unique par tenant", () => {
  it("normalise les valeurs et signale chaque correction", () => {
    const result = validateCompanyProfile({
      legalName: "  Sahel   Distribution SARL ",
      countryCode: "ci",
      email: "Contact@Sahel.Example",
      website: "sahel.example",
      capitalXof: " 10 000 000 ",
      paymentTermDays: "30",
      defaultIncoterm: "fob",
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "E-mail normalisé en minuscules.",
        "Pays normalisé en majuscules.",
        "Site web : schéma https:// ajouté.",
        "Capital : espaces de séparation retirés.",
        "Incoterm normalisé en majuscules.",
      ]),
    );
    expect(result.data).toMatchObject({
      legalName: "Sahel Distribution SARL",
      countryCode: "CI",
      email: "contact@sahel.example",
      website: "https://sahel.example",
      capitalXof: 10_000_000,
      defaultIncoterm: "FOB",
    });
  });

  it("refuse les identités incomplètes ou hors bornes", () => {
    const empty = validateCompanyProfile({ legalName: "   " });
    expect(empty.errors).toContain("Raison sociale : obligatoire.");

    const longName = validateCompanyProfile({ legalName: "a".repeat(161) });
    expect(longName.errors).toContain("Raison sociale : 160 caractères maximum.");

    const badCapital = validateCompanyProfile({
      legalName: "Société",
      capitalXof: "1 000,50",
    });
    expect(badCapital.errors).toContain("Capital : montant XOF entier attendu, sans décimale.");

    const badCountry = validateCompanyProfile({ legalName: "Société", countryCode: "CIV" });
    expect(badCountry.errors).toContain("Pays : code ISO 3166-1 à deux lettres attendu.");

    const badEmail = validateCompanyProfile({ legalName: "Société", email: "sans-arobase" });
    expect(badEmail.errors).toContain("E-mail : adresse invalide.");

    const badWebsite = validateCompanyProfile({
      legalName: "Société",
      website: "javascript:alert(1)",
    });
    expect(badWebsite.errors.length).toBeGreaterThan(0);

    const badFooter = validateCompanyProfile({
      legalName: "Société",
      invoiceFooter: "a".repeat(501),
    });
    expect(badFooter.errors).toContain("Mentions de facture : 500 caractères maximum.");
  });

  it("crée une seule fiche, la met à jour et trace les champs modifiés", async () => {
    const tenantId = await makeTenant("org-unique");
    const actorUserId = await makeUser(tenantId);

    const created = await updateCompanySettings(db, {
      tenantId,
      actorUserId,
      data: profile(),
    });
    expect(created.created).toBe(true);
    expect(created.changed).toContain("legalName");

    const updated = await updateCompanySettings(db, {
      tenantId,
      actorUserId,
      data: profile({ legalName: "Sahel Distribution & Fils SARL", paymentTermDays: 45 }),
    });
    expect(updated.created).toBe(false);
    expect(updated.changed).toEqual(expect.arrayContaining(["legalName", "paymentTermDays"]));

    const [rowCount] = await db
      .select({ value: count() })
      .from(companySettings)
      .where(eq(companySettings.tenantId, tenantId));
    expect(rowCount?.value).toBe(1);

    const summary = await getCompanySettings(db, tenantId);
    expect(summary?.legalName).toBe("Sahel Distribution & Fils SARL");
    expect(summary?.paymentTermDays).toBe(45);

    const events = await db
      .select({ action: auditEvents.action, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "settings.company.update")),
      );
    expect(events).toHaveLength(2);
    const updateEvent = events.find(
      (event) => (event.details as { created?: boolean }).created === false,
    );
    const last = updateEvent?.details as {
      before?: Record<string, unknown>;
      changed?: string[];
    };
    expect(last.changed).toEqual(expect.arrayContaining(["legalName", "paymentTermDays"]));
    expect(last.before?.legalName).toBe("Sahel Distribution SARL");
  });

  it("isole les fiches de deux tenants", async () => {
    const tenantA = await makeTenant("org-a");
    const tenantB = await makeTenant("org-b");
    const userA = await makeUser(tenantA);
    const userB = await makeUser(tenantB);

    await updateCompanySettings(db, {
      tenantId: tenantA,
      actorUserId: userA,
      data: profile({ legalName: "Entreprise A" }),
    });
    await updateCompanySettings(db, {
      tenantId: tenantB,
      actorUserId: userB,
      data: profile({ legalName: "Entreprise B" }),
    });

    const a = await getCompanySettings(db, tenantA);
    const b = await getCompanySettings(db, tenantB);
    expect(a?.legalName).toBe("Entreprise A");
    expect(b?.legalName).toBe("Entreprise B");
    expect(a?.id).not.toBe(b?.id);
  });
});

describe("ORG-002 — logo de l'entreprise", () => {
  it("accepte PNG, JPEG et WebP sur signature binaire", () => {
    expect(validateLogo({ bytes: pngBytes(), declaredMime: "image/png" }).data.mime).toBe(
      "image/png",
    );
    expect(validateLogo({ bytes: jpegBytes(), declaredMime: "image/jpeg" }).data.mime).toBe(
      "image/jpeg",
    );
    expect(validateLogo({ bytes: webpBytes(), declaredMime: "image/webp" }).data.mime).toBe(
      "image/webp",
    );

    const mismatch = validateLogo({ bytes: pngBytes(), declaredMime: "image/jpeg" });
    expect(mismatch.data.mime).toBe("image/png");
    expect(mismatch.warnings[0]).toContain("type déclaré image/jpeg ignoré");
  });

  it("refuse un contenu inconnu, vide ou trop lourd", () => {
    expect(validateLogo({ bytes: new Uint8Array([1, 2, 3]) }).errors[0]).toContain(
      "signature binaire non reconnue",
    );
    expect(validateLogo({ bytes: new Uint8Array() }).errors).toContain("Logo : fichier vide.");
    expect(validateLogo({ bytes: new Uint8Array(MAX_LOGO_BYTES + 1) }).errors).toContain(
      "Logo : 512 Kio maximum.",
    );
  });

  it("stocke, remplace et retire le logo sans franchir le tenant", async () => {
    const tenantA = await makeTenant("logo-a");
    const tenantB = await makeTenant("logo-b");
    const userA = await makeUser(tenantA);
    const userB = await makeUser(tenantB);

    await setCompanyLogo(db, {
      tenantId: tenantA,
      actorUserId: userA,
      legalName: "Logo A",
      mime: "image/png",
      data: pngBytes(),
    });
    await setCompanyLogo(db, {
      tenantId: tenantB,
      actorUserId: userB,
      legalName: "Logo B",
      mime: "image/jpeg",
      data: jpegBytes(),
    });

    const logoA = await getCompanyLogo(db, tenantA);
    const logoB = await getCompanyLogo(db, tenantB);
    expect(logoA?.mime).toBe("image/png");
    expect(logoB?.mime).toBe("image/jpeg");
    expect(Array.from(logoA?.data ?? [])).toEqual(Array.from(pngBytes()));

    await setCompanyLogo(db, {
      tenantId: tenantA,
      actorUserId: userA,
      legalName: "Logo A",
      mime: "image/webp",
      data: webpBytes(),
    });
    expect((await getCompanyLogo(db, tenantA))?.mime).toBe("image/webp");

    expect(await clearCompanyLogo(db, { tenantId: tenantA, actorUserId: userA })).toBe(true);
    expect(await getCompanyLogo(db, tenantA)).toBeNull();
    expect(await clearCompanyLogo(db, { tenantId: tenantA, actorUserId: userA })).toBe(false);
    expect((await getCompanyLogo(db, tenantB))?.mime).toBe("image/jpeg");

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantA));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(["settings.logo.update", "settings.logo.delete"]),
    );
  });
});

describe("ORG-003 — conditions et mentions par défaut", () => {
  it("encadre le délai, l'incoterm et les mentions", () => {
    expect(
      validateCompanyProfile({ legalName: "Société", paymentTermDays: "366" }).errors,
    ).toContain("Délai de règlement : entier entre 0 et 365 attendu.");
    expect(
      validateCompanyProfile({ legalName: "Société", paymentTermDays: "-1" }).errors,
    ).toContain("Délai de règlement : nombre entier de jours attendu.");
    expect(
      validateCompanyProfile({ legalName: "Société", paymentTermDays: "1.5" }).errors,
    ).toContain("Délai de règlement : nombre entier de jours attendu.");
    expect(
      validateCompanyProfile({ legalName: "Société", defaultIncoterm: "XYZ" }).errors[0],
    ).toContain("Incoterm inconnu");

    const emptyIncoterm = validateCompanyProfile({ legalName: "Société", defaultIncoterm: "" });
    expect(emptyIncoterm.data.defaultIncoterm).toBeNull();
  });

  it("ne réécrit jamais un document existant", async () => {
    const ids = await seedSalesTenant(db, "org-conditions");
    const order = await createSalesOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: {
        customerId: ids.customerId,
        expectedDeliveryDate: "",
        externalReference: "",
        incoterm: "EXW",
        notes: "",
        lines: [{ articleId: ids.productId, qty: 1, unitPriceXof: 1500 }],
      },
    });

    await updateCompanySettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      data: profile({ defaultIncoterm: "FOB", paymentTermDays: 60 }),
    });

    const reread = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: order.id });
    expect(reread?.order.incoterm).toBe("EXW");
  });
});

describe("ORG-004 — coordonnées bancaires", () => {
  it("forme un bloc complet ou reste vide", () => {
    const empty = validateCompanyProfile({ legalName: "Société" });
    expect(empty.errors).toEqual([]);
    expect(empty.data.bankName).toBeNull();

    const partial = validateCompanyProfile({
      legalName: "Société",
      bankName: "Banque Atlantique",
    });
    expect(partial.errors).toContain(
      "Coordonnées bancaires : banque, titulaire et numéro de compte vont ensemble.",
    );

    const withSwiftOnly = validateCompanyProfile({
      legalName: "Société",
      bankSwift: "ATLNCIAB",
    });
    expect(withSwiftOnly.errors).toContain(
      "Coordonnées bancaires : banque, titulaire et numéro de compte vont ensemble.",
    );
  });

  it("normalise le compte et valide SWIFT/BIC", () => {
    const result = validateCompanyProfile({
      legalName: "Société",
      bankName: "Banque Atlantique",
      bankAccountHolder: "Société",
      bankAccountNumber: "ci93 0010 0000 0000",
      bankSwift: "atln ciab",
    });
    expect(result.errors).toEqual([]);
    expect(result.data.bankAccountNumber).toBe("CI93001000000000");
    expect(result.data.bankSwift).toBe("ATLNCIAB");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Numéro de compte normalisé en majuscules, sans espaces.",
        "SWIFT/BIC normalisé en majuscules, sans espaces.",
      ]),
    );

    const invalidAccount = validateCompanyProfile({
      legalName: "Société",
      bankName: "Banque",
      bankAccountHolder: "Société",
      bankAccountNumber: "12-34",
    });
    expect(invalidAccount.errors).toContain(
      "Numéro de compte : 5 à 34 caractères alphanumériques attendus.",
    );

    const invalidSwift = validateCompanyProfile({
      legalName: "Société",
      bankName: "Banque",
      bankAccountHolder: "Société",
      bankAccountNumber: "CI93001000000000",
      bankSwift: "ATLNCIABX",
    });
    expect(invalidSwift.errors).toContain(
      "SWIFT/BIC : 8 ou 11 caractères alphanumériques attendus.",
    );
  });
});

describe("ORG-005 — contacts multiples par tiers", () => {
  it("valide le nom, les coordonnées et le statut principal", () => {
    expect(validatePartnerContact({ fullName: " " }).errors).toContain(
      "Nom du contact : obligatoire.",
    );
    expect(validatePartnerContact({ fullName: "a".repeat(121) }).errors).toContain(
      "Nom du contact : 120 caractères maximum.",
    );
    expect(validatePartnerContact({ fullName: "Awa", email: "awa-at-example" }).errors).toContain(
      "E-mail : adresse invalide.",
    );
    expect(validatePartnerContact({ fullName: "Awa", phone: "appeler Awa" }).errors).toContain(
      "Téléphone : 30 caractères maximum, chiffres et séparateurs autorisés.",
    );
    expect(
      validatePartnerContact({ fullName: "Awa", active: false, isPrimary: true }).errors,
    ).toContain("Un contact principal doit être actif.");

    const reachable = validatePartnerContact({
      fullName: "  Awa   Traoré ",
      email: "AWA@Example.COM",
      phone: "+225 07 00 00 00 00",
    });
    expect(reachable.data.fullName).toBe("Awa Traoré");
    expect(reachable.data.email).toBe("awa@example.com");
    expect(reachable.warnings).toContain("E-mail normalisé en minuscules.");
  });

  it("garde un seul principal, le remplace et le retire à la désactivation", async () => {
    const tenantId = await makeTenant("contacts-a");
    const actorUserId = await makeUser(tenantId);
    const partnerId = await makePartner(tenantId, "CLI-CONTACT");

    const first = await createPartnerContact(db, {
      tenantId,
      actorUserId,
      partnerId,
      data: contact({ fullName: "Aminata Koné", isPrimary: true }),
    });
    const second = await createPartnerContact(db, {
      tenantId,
      actorUserId,
      partnerId,
      data: contact({ fullName: "Bakary Diallo", email: "bakary@example.com", isPrimary: true }),
    });

    let rows = await listPartnerContacts(db, { tenantId, partnerId });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([second.id]);

    await updatePartnerContact(db, {
      tenantId,
      actorUserId,
      partnerId,
      contactId: second.id,
      data: contact({
        fullName: "Bakary Diallo",
        email: "bakary@example.com",
        active: false,
        isPrimary: false,
      }),
    });

    rows = await listPartnerContacts(db, { tenantId, partnerId });
    expect(rows.filter((row) => row.isPrimary)).toHaveLength(0);
    expect(rows.find((row) => row.id === second.id)?.active).toBe(false);
    expect(
      await getPartnerContact(db, { tenantId, partnerId, contactId: first.id }),
    ).not.toBeNull();

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId));
    expect(events.map((row) => row.action)).toEqual(
      expect.arrayContaining(["catalog.partner.contact.create", "catalog.partner.contact.update"]),
    );
  });

  it("refuse un contact d'un autre tenant ou d'un autre tiers", async () => {
    const tenantA = await makeTenant("contacts-tenant-a");
    const tenantB = await makeTenant("contacts-tenant-b");
    const userA = await makeUser(tenantA);
    const userB = await makeUser(tenantB);
    const partnerA = await makePartner(tenantA, "CLI-A");
    const partnerB = await makePartner(tenantB, "CLI-B");

    const created = await createPartnerContact(db, {
      tenantId: tenantA,
      actorUserId: userA,
      partnerId: partnerA,
      data: contact(),
    });

    await expect(
      createPartnerContact(db, {
        tenantId: tenantB,
        actorUserId: userB,
        partnerId: partnerA,
        data: contact(),
      }),
    ).rejects.toThrow(/Tiers introuvable/);

    await expect(
      updatePartnerContact(db, {
        tenantId: tenantB,
        actorUserId: userB,
        partnerId: partnerB,
        contactId: created.id,
        data: contact(),
      }),
    ).rejects.toThrow(/Contact introuvable/);

    expect(
      await getPartnerContact(db, {
        tenantId: tenantB,
        partnerId: partnerB,
        contactId: created.id,
      }),
    ).toBeNull();
    expect(
      await db
        .select({ value: count() })
        .from(partnerContacts)
        .where(eq(partnerContacts.tenantId, tenantB)),
    ).toEqual([{ value: 0 }]);
  });
});

describe("TEN-007 — lecture et écriture des paramètres", () => {
  it("réserve settings.manage au propriétaire et à l'administrateur", () => {
    expect(can("owner", "settings.manage")).toBe(true);
    expect(can("admin", "settings.manage")).toBe(true);
    expect(can("member", "settings.manage")).toBe(false);
    expect(can("member", "data.read")).toBe(true);
  });
});
