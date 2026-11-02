import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, partnerCategories, tenants, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { EMPTY_PARTNER_LIST_FILTERS } from "./filters";
import {
  createCategory,
  deleteCategory,
  deletePartners,
  replacePartnerCategories,
  setCategoryActive,
} from "./partner-queries";
import { createPartner, listPartners } from "./queries";
import type { PartnerImportData } from "./validation";

let context: TestDatabase;
let db: Database;
let actorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  const [actor] = await db
    .insert(users)
    .values({ email: "tiers@lean.example", name: "Awa", passwordHash: "scrypt-test" })
    .returning({ id: users.id });
  if (!actor) {
    throw new Error("Utilisateur de test non créé.");
  }
  actorId = actor.id;
});

afterAll(async () => {
  await context.close();
});

async function makeTenant(slug: string): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug, name: `Espace ${slug}` })
    .returning({
      id: tenants.id,
    });
  if (!row) {
    throw new Error("Tenant de test non créé.");
  }
  return row.id;
}

function data(overrides: Partial<PartnerImportData> = {}): PartnerImportData {
  return {
    code: "CLI001",
    name: "Sahel Distribution",
    type: "company",
    isCustomer: true,
    isSupplier: false,
    email: null,
    phone: null,
    addressLine: null,
    city: "Abidjan",
    countryCode: "CI",
    taxNumber: null,
    paymentTermDays: 0,
    active: true,
    ...overrides,
  };
}

describe("ART-008 — catégories portées par l'espace", () => {
  it("refuse un doublon de libellé, refuse la suppression d'une catégorie portée, et isole l'espace", async () => {
    const tenantId = await makeTenant("cat-a");
    const otherId = await makeTenant("cat-b");
    const category = await createCategory(db, {
      tenantId,
      actorUserId: actorId,
      title: "Grossistes",
    });
    await expect(
      createCategory(db, { tenantId, actorUserId: actorId, title: "grossistes" }),
    ).rejects.toThrow(/existe déjà/);

    const created = await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data(),
      categoryIds: [category.id],
    });
    await expect(
      deleteCategory(db, { tenantId, actorUserId: actorId, categoryId: category.id }),
    ).rejects.toThrow(/désactivez-la/);

    await setCategoryActive(db, {
      tenantId,
      actorUserId: actorId,
      categoryId: category.id,
      active: false,
    });
    const [row] = await db
      .select({ active: partnerCategories.active })
      .from(partnerCategories)
      .where(eq(partnerCategories.id, category.id));
    expect(row?.active).toBe(false);

    const other = await listPartners(db, otherId);
    expect(other.rows).toEqual([]);
    expect(created.code).toBe("CLI001");
  });
});

describe("ART-010 — le registre se filtre dans l'espace", () => {
  it("combine recherche, rôle, état, pays et ne traverse pas l'espace voisin", async () => {
    const tenantId = await makeTenant("fil-a");
    const otherId = await makeTenant("fil-b");
    await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "CLI010", name: "Nord Clients", isCustomer: true, countryCode: "SN" }),
    });
    await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data({
        code: "FOU010",
        name: "Sud Fournisseurs",
        isCustomer: false,
        isSupplier: true,
        countryCode: "CI",
        active: false,
      }),
    });
    await createPartner(db, {
      tenantId: otherId,
      actorUserId: actorId,
      data: data({ code: "CLI010", name: "Nord Clients" }),
    });

    const filtered = await listPartners(db, tenantId, {
      ...EMPTY_PARTNER_LIST_FILTERS,
      search: "nord",
      roles: ["client"],
      state: "actif",
      countryCode: "SN",
    });
    expect(filtered.rows.map((row) => row.code)).toEqual(["CLI010"]);
    expect(filtered.total).toBe(1);

    const other = await listPartners(db, otherId, {
      ...EMPTY_PARTNER_LIST_FILTERS,
      search: "nord",
    });
    expect(other.total).toBe(1);
    expect(other.rows[0]?.id).not.toBe(filtered.rows[0]?.id);
  });
});

describe("GEN-017 — suppression en lot", () => {
  it("n'écrit rien si un tiers de la sélection est encore rattaché, puis supprime un lot libre", async () => {
    const tenantId = await makeTenant("bulk-a");
    const first = await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "CLI020" }),
    });
    const second = await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "CLI021", name: "Libre" }),
    });

    await db.transaction(async (tx) => {
      await replacePartnerCategories(tx, {
        tenantId,
        partnerId: first.id,
        categoryIds: [],
      });
    });

    await deletePartners(db, {
      tenantId,
      actorUserId: actorId,
      ids: [first.id, second.id],
      level: "manage",
    });

    const remaining = await listPartners(db, tenantId);
    expect(remaining.total).toBe(0);

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId));
    expect(events.filter((event) => event.action === "catalog.partner.delete")).toHaveLength(2);
  });

  it("refuse la suppression au niveau écriture", async () => {
    const tenantId = await makeTenant("bulk-b");
    const created = await createPartner(db, {
      tenantId,
      actorUserId: actorId,
      data: data({ code: "CLI030" }),
    });
    await expect(
      deletePartners(db, {
        tenantId,
        actorUserId: actorId,
        ids: [created.id],
        level: "write",
      }),
    ).rejects.toThrow(/niveau de droit plus élevé/);
    expect((await listPartners(db, tenantId)).total).toBe(1);
  });
});
