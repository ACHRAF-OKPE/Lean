import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  importBatches,
  importRows,
  partners,
  tenants,
  users,
  type ImportKind,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { analyzeImport, applyImportBatch, getImportBatch, listImportBatches } from "./imports";
import { listArticles, listHsCodes, listPartners } from "./queries";
import type { RawImportRow } from "./validation";

let context: TestDatabase;
let db: Database;
let actorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;

  const [actor] = await db
    .insert(users)
    .values({
      email: "import@lean.example",
      name: "Awa",
      passwordHash: "scrypt-test",
    })
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
    .returning({ id: tenants.id });
  if (!row) {
    throw new Error("Tenant de test non créé.");
  }
  return row.id;
}

function hashOf(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function analyze(
  tenantId: string,
  kind: ImportKind,
  rows: readonly RawImportRow[],
  options: { fileHash?: string; notes?: readonly string[] } = {},
) {
  return analyzeImport(db, {
    tenantId,
    actorUserId: actorId,
    kind,
    fileName: `import-${kind}.xlsx`,
    fileHash: options.fileHash ?? hashOf(`${tenantId}-${kind}-${Math.random()}`),
    sheetName: "Données",
    rows,
    notes: options.notes ?? [],
  });
}

function partnerRow(rowNumber: number, overrides: Record<string, unknown> = {}): RawImportRow {
  return {
    rowNumber,
    values: {
      code: "CLI001",
      nom: "Sahel Distribution",
      type: "Entreprise",
      client: "Oui",
      fournisseur: "Non",
      email: "contact@sahel.example",
      ville: "Dakar",
      pays: "SN",
      delai_paiement_jours: "30",
      actif: "Oui",
      ...overrides,
    },
  };
}

function hsRow(
  rowNumber: number,
  code: string,
  wording: string,
  parentCode: string | null = null,
): RawImportRow {
  return { rowNumber, values: { code, libelle: wording, code_parent: parentCode } };
}

function articleRow(
  rowNumber: number,
  code: string,
  type: "Produit" | "Service",
  hsCode: string | null,
): RawImportRow {
  return {
    rowNumber,
    values: {
      code,
      designation: `Article ${code}`,
      type,
      unite: type === "Produit" ? "KG" : "H",
      code_sh: hsCode,
      prix_vente_xof: "250000",
      prix_achat_xof: "180000",
      vendable: "Oui",
      achetable: "Oui",
      pays_origine: "CI",
      actif: "Oui",
    },
  };
}

describe("ART-005 / ART-006 — analyse sans écriture puis application par code", () => {
  it("produit un rapport ligne à ligne, n'écrit rien à l'analyse et applique les codes", async () => {
    const tenantId = await makeTenant("alpha");
    await db.insert(partners).values({
      tenantId,
      code: "CLI002",
      name: "Ancien nom",
      type: "company",
      isSupplier: true,
    });

    const result = await analyze(tenantId, "partners", [
      partnerRow(2, { code: "CLI001", nom: "Sahel Distribution" }),
      partnerRow(3, {
        code: "CLI002",
        nom: "Nouveau nom",
        client: "Oui",
        fournisseur: "Non",
      }),
    ]);

    expect(result).toMatchObject({ rowCount: 2, errorCount: 0, warningCount: 1 });

    const untouched = await db.select().from(partners).where(eq(partners.tenantId, tenantId));
    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.name).toBe("Ancien nom");

    const detail = await getImportBatch(db, { tenantId, batchId: result.batchId });
    expect(detail?.batch.status).toBe("analyzed");
    expect(detail?.batch.appliedAt).toBeNull();
    expect(detail?.rows.map((row) => row.code)).toEqual(["CLI001", "CLI002"]);
    expect(detail?.rows.map((row) => row.status)).toEqual(["valid", "warning"]);
    expect(detail?.rows[1]?.warnings).toContain(
      "Code déjà présent : la ligne mettra à jour le tiers existant.",
    );

    const applied = await applyImportBatch(db, {
      tenantId,
      batchId: result.batchId,
      actorUserId: actorId,
    });
    expect(applied).toEqual({ kind: "partners", written: 2 });

    const catalog = await listPartners(db, tenantId);
    expect(catalog.total).toBe(2);
    expect(catalog.rows.find((row) => row.code === "CLI002")?.name).toBe("Nouveau nom");

    const [batchRow] = await db
      .select({
        status: importBatches.status,
        appliedAt: importBatches.appliedAt,
      })
      .from(importBatches)
      .where(eq(importBatches.id, result.batchId));
    expect(batchRow?.status).toBe("applied");
    expect(batchRow?.appliedAt).toBeInstanceOf(Date);

    const linked = await db
      .select({ entityId: importRows.entityId })
      .from(importRows)
      .where(and(eq(importRows.tenantId, tenantId), eq(importRows.batchId, result.batchId)));
    expect(linked).toHaveLength(2);
    expect(linked.every((row) => row.entityId !== null)).toBe(true);

    const audit = await db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "catalog.import.apply")),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ kind: "partners", written: 2 });
  });

  it("conserve les notes de fichier et l'empreinte du lot", async () => {
    const tenantId = await makeTenant("trace");
    const fileHash = hashOf("trace-partners");

    const result = await analyze(tenantId, "partners", [partnerRow(2)], {
      fileHash,
      notes: ["Colonnes supplémentaires ignorées : N (« commentaire »)."],
    });

    const [batch] = await db
      .select({ fileHash: importBatches.fileHash, notes: importBatches.notes })
      .from(importBatches)
      .where(eq(importBatches.id, result.batchId));
    expect(batch?.fileHash).toBe(fileHash);
    expect(batch?.notes).toContain("Colonnes supplémentaires ignorées : N (« commentaire »).");
  });
});

describe("ART-006 — idempotence d'un lot", () => {
  it("avertit qu'un fichier identique a déjà été appliqué et refuse un second apply", async () => {
    const tenantId = await makeTenant("idempotent");
    const fileHash = hashOf("same-file");

    const first = await analyze(tenantId, "partners", [partnerRow(2)], { fileHash });
    await applyImportBatch(db, {
      tenantId,
      batchId: first.batchId,
      actorUserId: actorId,
    });

    const second = await analyze(tenantId, "partners", [partnerRow(2)], { fileHash });

    expect(second.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Un import identique a déjà été appliqué le"),
      ]),
    );

    const secondDetail = await getImportBatch(db, {
      tenantId,
      batchId: second.batchId,
    });
    expect(secondDetail?.batch.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("déjà été appliqué")]),
    );

    await expect(
      applyImportBatch(db, {
        tenantId,
        batchId: first.batchId,
        actorUserId: actorId,
      }),
    ).rejects.toThrow("Cet import a déjà été appliqué.");

    const history = await listImportBatches(db, { tenantId });
    expect(history).toHaveLength(2);
    expect(history.filter((batch) => batch.status === "applied")).toHaveLength(1);
  });

  it("refuse d'appliquer un lot contenant une ligne en erreur", async () => {
    const tenantId = await makeTenant("with-errors");

    const result = await analyze(tenantId, "partners", [partnerRow(2, { nom: "" })]);
    expect(result.errorCount).toBe(1);

    await expect(
      applyImportBatch(db, {
        tenantId,
        batchId: result.batchId,
        actorUserId: actorId,
      }),
    ).rejects.toThrow(/Des lignes sont en erreur/);

    const [batch] = await db
      .select({ status: importBatches.status })
      .from(importBatches)
      .where(eq(importBatches.id, result.batchId));
    expect(batch?.status).toBe("analyzed");

    const written = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.tenantId, tenantId));
    expect(written).toHaveLength(0);
  });
});

describe("GEN-008 / ART-006 — isolation par tenant", () => {
  it("ne permet ni de lire ni d'appliquer le lot d'un autre espace", async () => {
    const tenantA = await makeTenant("iso-a");
    const tenantB = await makeTenant("iso-b");
    const fileHash = hashOf("shared-file");

    const batchA = await analyze(tenantA, "partners", [partnerRow(2, { nom: "Sahel A" })], {
      fileHash,
    });
    const batchB = await analyze(tenantB, "partners", [partnerRow(2, { nom: "Sahel B" })], {
      fileHash,
    });

    expect(await getImportBatch(db, { tenantId: tenantA, batchId: batchB.batchId })).toBeNull();

    await expect(
      applyImportBatch(db, {
        tenantId: tenantA,
        batchId: batchB.batchId,
        actorUserId: actorId,
      }),
    ).rejects.toThrow("Import introuvable dans cet espace de travail.");

    await applyImportBatch(db, {
      tenantId: tenantA,
      batchId: batchA.batchId,
      actorUserId: actorId,
    });
    await applyImportBatch(db, {
      tenantId: tenantB,
      batchId: batchB.batchId,
      actorUserId: actorId,
    });

    const catalogA = await listPartners(db, tenantA);
    const catalogB = await listPartners(db, tenantB);
    expect(catalogA.total).toBe(1);
    expect(catalogB.total).toBe(1);
    expect(catalogA.rows[0]?.name).toBe("Sahel A");
    expect(catalogB.rows[0]?.name).toBe("Sahel B");
  });
});

describe("ART-003 / ART-004 — nomenclature puis articles", () => {
  it("exige la nomenclature avant les articles puis lie chaque produit à son code SH", async () => {
    const tenantId = await makeTenant("customs");

    const tooEarly = await analyze(tenantId, "articles", [
      articleRow(2, "ART001", "Produit", "09011100"),
    ]);
    expect(tooEarly.errorCount).toBe(1);
    const tooEarlyDetail = await getImportBatch(db, {
      tenantId,
      batchId: tooEarly.batchId,
    });
    expect(tooEarlyDetail?.rows[0]?.errors.join(" ")).toContain(
      "inconnu : importez d'abord la nomenclature douanière",
    );

    const nomenclature = await analyze(tenantId, "hs_codes", [
      hsRow(2, "090111", "Café non torréfié"),
      hsRow(3, "09011100", "Café non torréfié", "090111"),
    ]);
    expect(nomenclature).toMatchObject({ rowCount: 2, errorCount: 0 });
    await applyImportBatch(db, {
      tenantId,
      batchId: nomenclature.batchId,
      actorUserId: actorId,
    });

    const hsCatalog = await listHsCodes(db, tenantId);
    expect(hsCatalog.total).toBe(2);
    expect(hsCatalog.rows.map((row) => row.code)).toEqual(["090111", "09011100"]);

    const catalogImport = await analyze(tenantId, "articles", [
      articleRow(2, "ART001", "Produit", "09011100"),
      articleRow(3, "SRV001", "Service", null),
    ]);
    expect(catalogImport.errorCount).toBe(0);
    const applied = await applyImportBatch(db, {
      tenantId,
      batchId: catalogImport.batchId,
      actorUserId: actorId,
    });
    expect(applied).toEqual({ kind: "articles", written: 2 });

    const articleRows = await db
      .select({ code: articles.code, hsCodeId: articles.hsCodeId })
      .from(articles)
      .where(eq(articles.tenantId, tenantId));
    const product = articleRows.find((row) => row.code === "ART001");
    const service = articleRows.find((row) => row.code === "SRV001");
    expect(product?.hsCodeId).toBeTruthy();
    expect(service?.hsCodeId).toBeNull();

    const catalog = await listArticles(db, tenantId);
    expect(catalog.rows.find((row) => row.code === "ART001")?.hsCode).toBe("09011100");
    expect(catalog.rows.find((row) => row.code === "SRV001")?.hsCode).toBeNull();
  });
});

describe("ART-007 — l'import ne supprime jamais", () => {
  it("conserve les enregistrements absents du second fichier et désactive par le champ actif", async () => {
    const tenantId = await makeTenant("no-delete");

    const initial = await analyze(tenantId, "partners", [
      partnerRow(2, { code: "CLI001", nom: "Sahel Distribution" }),
      partnerRow(3, { code: "CLI002", nom: "Baobab Négoce" }),
    ]);
    await applyImportBatch(db, {
      tenantId,
      batchId: initial.batchId,
      actorUserId: actorId,
    });

    const update = await analyze(tenantId, "partners", [
      partnerRow(2, {
        code: "CLI001",
        nom: "Sahel Distribution (fermé)",
        actif: "Non",
      }),
    ]);
    await applyImportBatch(db, {
      tenantId,
      batchId: update.batchId,
      actorUserId: actorId,
    });

    const catalog = await listPartners(db, tenantId);
    expect(catalog.total).toBe(2);
    const first = catalog.rows.find((row) => row.code === "CLI001");
    const second = catalog.rows.find((row) => row.code === "CLI002");
    expect(first?.name).toBe("Sahel Distribution (fermé)");
    expect(first?.active).toBe(false);
    expect(second?.name).toBe("Baobab Négoce");
    expect(second?.active).toBe(true);
  });
});
