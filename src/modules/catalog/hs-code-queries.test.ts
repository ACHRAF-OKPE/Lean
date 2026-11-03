import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, hsCodes, tenants, users } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCustomsTenant } from "@/test/customs";
import { addDeclarationLine, createDeclaration } from "@/modules/customs/queries";
import {
  createHsCodeWithParents,
  deleteHsCode,
  ensureHsCodeParents,
  getHsCodeDetail,
  listHsParentFacts,
  updateHsCode,
} from "./hs-code-queries";
import { createArticle, listHsCodes } from "./queries";
import { EMPTY_HS_CODE_FILTERS, type HsCodeFilters } from "./hs-code-filters";
import type { HsCodeEditData } from "./hs-code-edit";
import { inheritanceFor } from "./hs-codes";

let context: TestDatabase;
let db: Database;
let actorId: string;
let tenantCounter = 0;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
  const [actor] = await db
    .insert(users)
    .values({ email: "nomenclature@lean.example", name: "Awa", passwordHash: "scrypt-test" })
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
  tenantCounter += 1;
  const [row] = await db
    .insert(tenants)
    .values({ slug: `${slug}-${tenantCounter}`, name: `Espace ${slug}` })
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Tenant de test non créé.");
  }
  return row.id;
}

function edit(overrides: Partial<HsCodeEditData> = {}): HsCodeEditData {
  return {
    wording: "Café non torréfié",
    parentCode: null,
    supplementaryUnit: null,
    tecRate: null,
    ...overrides,
  };
}

function filters(overrides: Partial<HsCodeFilters> = {}): HsCodeFilters {
  return { ...EMPTY_HS_CODE_FILTERS, ...overrides };
}

async function auditCount(tenantId: string, entityId: string, action: string): Promise<number> {
  const rows = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.entityId, entityId),
        eq(auditEvents.action, action),
      ),
    );
  return rows.length;
}

describe("ART-018 — la chaîne des parents se crée à la volée", () => {
  it("crée les parents manquants du plus lointain au plus proche et les trace", async () => {
    const tenantId = await makeTenant("hs-parents");

    const created = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "0901110000",
      data: edit({ parentCode: "09011100" }),
    });

    expect(created.created).toEqual(["090111", "09011100"]);
    const rows = await db
      .select({ code: hsCodes.code, wording: hsCodes.wording })
      .from(hsCodes)
      .where(eq(hsCodes.tenantId, tenantId));
    const byCode = new Map(rows.map((row) => [row.code, row.wording]));
    expect(byCode.get("090111")).toBe("À compléter");
    expect(byCode.get("09011100")).toBe("À compléter");
    expect(byCode.get("0901110000")).toBe("Café non torréfié");
    expect(await auditCount(tenantId, created.id, "catalog.hs_code.create")).toBe(1);
  });

  it("ne recrée pas un parent déjà présent", async () => {
    const tenantId = await makeTenant("hs-parents-connus");
    await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "09011100",
      data: edit({ parentCode: "090111" }),
    });

    const again = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "0901110000",
      data: edit({ parentCode: "09011100" }),
    });

    expect(again.created).toEqual([]);
    const created = await db.transaction((tx) =>
      ensureHsCodeParents(tx, { tenantId, actorUserId: actorId, code: "0901110000" }),
    );
    expect(created).toEqual([]);
  });

  it("hérite du parent le plus proche quand les champs sont vides", async () => {
    const tenantId = await makeTenant("hs-heritage");
    await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café", supplementaryUnit: "KG", tecRate: 20 }),
    });

    const parents = await listHsParentFacts(db, tenantId);
    const inherited = inheritanceFor("0901110000", parents);

    expect(inherited).toEqual({ parentCode: "090111", supplementaryUnit: "KG", tecRate: 20 });
  });
});

describe("ART-023 — la fiche d'un code SH", () => {
  it("rend le parent, les enfants et l'usage", async () => {
    const tenantId = await makeTenant("hs-fiche");
    const parent = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café non torréfié", tecRate: 20 }),
    });
    const child = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "09011100",
      data: edit({ wording: "Café vert", parentCode: "090111" }),
    });
    await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: {
        code: "ART001",
        name: "Café en sacs",
        description: null,
        type: "product",
        unitCode: "KG",
        hsCode: "090111",
        salePriceXof: 0,
        purchasePriceXof: 0,
        isSellable: true,
        isPurchasable: false,
        countryOfOrigin: "CI",
        active: true,
      },
    });

    const detail = await getHsCodeDetail(db, { tenantId, hsCodeId: parent.id });

    expect(detail?.parent).toBeNull();
    expect(detail?.children.map((row) => row.code)).toEqual(["09011100"]);
    expect(detail?.usage.articles.map((row) => row.code)).toEqual(["ART001"]);
    expect(detail?.usage.declarationLines).toBe(0);
    expect((await getHsCodeDetail(db, { tenantId, hsCodeId: child.id }))?.parent?.code).toBe(
      "090111",
    );
  });

  it("compte les lignes de déclaration qui citent le code", async () => {
    const seeded = await seedCustomsTenant(db, "hs-lignes");
    await createDeclaration(db, {
      tenantId: seeded.tenantId,
      actorUserId: seeded.userId,
      raw: {
        regimeId: seeded.plainRegimeId,
        officeId: seeded.officeId,
        partnerId: seeded.partnerId,
        declarationDate: "2026-11-03",
        externalReference: "DEC-1",
        freightAmountXof: 0,
        insuranceAmountXof: 0,
      },
    }).then(async (declaration) => {
      await addDeclarationLine(db, {
        tenantId: seeded.tenantId,
        actorUserId: seeded.userId,
        declarationId: declaration.id,
        raw: {
          hsCode: seeded.hsCode,
          designation: "Café vert",
          quantity: "10",
          unitCode: "KG",
          valueXof: "4500000",
          weightKg: "10",
          originCountry: "CI",
        },
      });
    });

    const [row] = await db
      .select({ id: hsCodes.id })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, seeded.tenantId), eq(hsCodes.code, seeded.hsCode)))
      .limit(1);

    const detail = await getHsCodeDetail(db, { tenantId: seeded.tenantId, hsCodeId: row!.id });
    expect(detail?.usage.declarationLines).toBe(1);
  });

  it("corrige la fiche et garde l'avant/après dans l'audit", async () => {
    const tenantId = await makeTenant("hs-correction");
    const created = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café", tecRate: 5 }),
    });

    await updateHsCode(db, {
      tenantId,
      actorUserId: actorId,
      hsCodeId: created.id,
      data: edit({ wording: "Café non torréfié", tecRate: 20 }),
    });

    const [row] = await db
      .select({ wording: hsCodes.wording, tecRate: hsCodes.tecRate })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, tenantId), eq(hsCodes.id, created.id)))
      .limit(1);
    expect(row).toEqual({ wording: "Café non torréfié", tecRate: 20 });

    const [event] = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          eq(auditEvents.entityId, created.id),
          eq(auditEvents.action, "catalog.hs_code.update"),
        ),
      )
      .limit(1);
    expect(event?.details).toMatchObject({
      before: { wording: "Café", tecRate: 5 },
      after: { wording: "Café non torréfié", tecRate: 20 },
    });
  });
});

describe("ART-023 — un code cité ne se supprime pas", () => {
  it("refuse la suppression d'un code porté par un article", async () => {
    const tenantId = await makeTenant("hs-refus-article");
    const created = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café non torréfié" }),
    });
    await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: {
        code: "ART001",
        name: "Café en sacs",
        description: null,
        type: "product",
        unitCode: "KG",
        hsCode: "090111",
        salePriceXof: 0,
        purchasePriceXof: 0,
        isSellable: true,
        isPurchasable: false,
        countryOfOrigin: null,
        active: true,
      },
    });

    await expect(
      deleteHsCode(db, { tenantId, actorUserId: actorId, hsCodeId: created.id }),
    ).rejects.toThrow(/référencé par articles \(1\)/);
  });

  it("refuse la suppression d'un code portant des enfants", async () => {
    const tenantId = await makeTenant("hs-refus-enfant");
    const parent = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café non torréfié" }),
    });
    await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "09011100",
      data: edit({ wording: "Café vert", parentCode: "090111" }),
    });

    await expect(
      deleteHsCode(db, { tenantId, actorUserId: actorId, hsCodeId: parent.id }),
    ).rejects.toThrow(/codes enfants \(1\)/);
  });

  it("supprime un code libre et le trace", async () => {
    const tenantId = await makeTenant("hs-suppression");
    const created = await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café non torréfié" }),
    });

    await deleteHsCode(db, { tenantId, actorUserId: actorId, hsCodeId: created.id });

    const rows = await db
      .select({ id: hsCodes.id })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, tenantId), eq(hsCodes.id, created.id)));
    expect(rows).toHaveLength(0);
    expect(await auditCount(tenantId, created.id, "catalog.hs_code.delete")).toBe(1);
  });
});

describe("ART-019 — le registre se filtre dans l'espace", () => {
  it("filtre par recherche, niveau, TEC et usage", async () => {
    const tenantId = await makeTenant("hs-filtres");
    const otherId = await makeTenant("hs-filtres-autres");
    await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "090111",
      data: edit({ wording: "Café non torréfié", tecRate: 20 }),
    });
    await createHsCodeWithParents(db, {
      tenantId,
      actorUserId: actorId,
      code: "0901110000",
      data: edit({ wording: "Café vert", parentCode: "09011100" }),
    });
    await createHsCodeWithParents(db, {
      tenantId: otherId,
      actorUserId: actorId,
      code: "170199",
      data: edit({ wording: "Sucre" }),
    });
    await createArticle(db, {
      tenantId,
      actorUserId: actorId,
      data: {
        code: "ART001",
        name: "Café en sacs",
        description: null,
        type: "product",
        unitCode: "KG",
        hsCode: "090111",
        salePriceXof: 0,
        purchasePriceXof: 0,
        isSellable: true,
        isPurchasable: false,
        countryOfOrigin: null,
        active: true,
      },
    });

    expect((await listHsCodes(db, tenantId)).rows.map((row) => row.code)).toEqual([
      "090111",
      "09011100",
      "0901110000",
    ]);
    expect(
      (await listHsCodes(db, tenantId, filters({ search: "sucre" }))).rows.map((row) => row.code),
    ).toEqual([]);
    expect(
      (await listHsCodes(db, tenantId, filters({ search: "café" }))).rows.map((row) => row.code),
    ).toEqual(["090111", "0901110000"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ level: 6 }))).rows.map((row) => row.code),
    ).toEqual(["090111"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ level: 10 }))).rows.map((row) => row.code),
    ).toEqual(["0901110000"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ tec: "present" }))).rows.map((row) => row.code),
    ).toEqual(["090111"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ tec: "absent" }))).rows.map((row) => row.code),
    ).toEqual(["09011100", "0901110000"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ usage: "utilise" }))).rows.map((row) => row.code),
    ).toEqual(["090111"]);
    expect(
      (await listHsCodes(db, tenantId, filters({ usage: "libre" }))).rows.map((row) => row.code),
    ).toEqual(["09011100", "0901110000"]);
  });
});
