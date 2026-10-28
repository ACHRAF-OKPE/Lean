import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedCustomsTenant, type CustomsTenant } from "@/test/customs";
import { todayIsoDate } from "@/lib/dates";
import { CustomsError } from "./errors";
import {
  addDeclarationLine,
  apureBond,
  changeDeclarationStatus,
  createBond,
  createCustomsOffice,
  createCustomsRegime,
  createCustomsTax,
  createDeclaration,
  getDeclaration,
  listCustomsReferentials,
  recordCustomsPayment,
  removeDeclarationLine,
  setCustomsOfficeActive,
  setCustomsTaxActive,
  updateDeclarationHeader,
  type DeclarationDetail,
} from "./queries";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createDraft(
  ids: CustomsTenant,
  options: {
    regimeId?: string;
    partnerId?: string;
    officeId?: string;
    freight?: number;
    insurance?: number;
    date?: string;
    reference?: string;
  } = {},
): Promise<{ id: string; number: string }> {
  return createDeclaration(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    raw: {
      regimeId: options.regimeId ?? ids.plainRegimeId,
      officeId: options.officeId ?? ids.officeId,
      partnerId: options.partnerId ?? ids.partnerId,
      declarationDate: options.date ?? "2026-10-15",
      externalReference: options.reference ?? "",
      freightAmountXof: options.freight ?? 0,
      insuranceAmountXof: options.insurance ?? 0,
    },
  });
}

async function addLine(
  ids: CustomsTenant,
  declarationId: string,
  options: { hsCode?: string; value?: number; designation?: string } = {},
): Promise<string> {
  const created = await addDeclarationLine(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    declarationId,
    raw: {
      hsCode: options.hsCode ?? ids.hsCode,
      designation: options.designation ?? "Marchandise déclarée",
      quantity: "10",
      unitCode: "KG",
      valueXof: options.value ?? 1_000_000,
      weightKg: "10",
      originCountry: "CI",
    },
  });
  return created.id;
}

async function transition(
  ids: CustomsTenant,
  declarationId: string,
  step: "deposit" | "liquidate" | "clear" | "cancel",
): Promise<void> {
  await changeDeclarationStatus(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    declarationId,
    transition: step,
  });
}

async function detail(ids: CustomsTenant, declarationId: string): Promise<DeclarationDetail> {
  const found = await getDeclaration(db, { tenantId: ids.tenantId, declarationId });
  if (!found) {
    throw new Error("Déclaration introuvable.");
  }
  return found;
}

async function liquidatedDeclaration(
  ids: CustomsTenant,
  options: { regimeId?: string; value?: number } = {},
): Promise<{ id: string; grandTotal: number }> {
  const created = await createDraft(ids, { regimeId: options.regimeId });
  await addLine(ids, created.id, { value: options.value ?? 1_000_000 });
  await transition(ids, created.id, "deposit");
  await transition(ids, created.id, "liquidate");
  const declaration = await detail(ids, created.id);
  return { id: created.id, grandTotal: declaration.grandTotal };
}

describe("CUS-001 — référentiels douaniers", () => {
  it("valide les bureaux, régimes et taxes, journalise les mutations et refuse les doublons", async () => {
    const ids = await seedCustomsTenant(db, "cus001");

    await expect(
      createCustomsOffice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "CIABJ", name: "Doublon" },
      }),
    ).rejects.toThrow(/existe déjà/);

    await expect(
      createCustomsOffice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "ab", name: "Trop court" },
      }),
    ).rejects.toThrow(/UN\/LOCODE/);

    await expect(
      createCustomsRegime(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "ZZ", label: "Régime inconnu", kind: "autre", requiresBond: "on" },
      }),
    ).rejects.toThrow(/Nature du régime/);

    await expect(
      createCustomsTax(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        raw: { code: "TS", label: "Taxe spéciale", base: "cif", rateBp: "101", position: "30" },
      }),
    ).rejects.toThrow(/Taux/);

    const created = await createCustomsTax(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: { code: "TS", label: "Taxe spéciale", base: "cif", rateBp: "2,5", position: "30" },
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    await setCustomsTaxActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      taxId: created.id,
      active: false,
    });

    const referentials = await listCustomsReferentials(db, ids.tenantId);
    expect(referentials.offices.map((office) => office.code)).toEqual(["CIABJ"]);
    expect(referentials.regimes.map((regime) => regime.code)).toEqual(["IM4", "IM8"]);
    const tax = referentials.taxes.find((row) => row.code === "TS");
    expect(tax).toMatchObject({ base: "cif", rateBp: 250, position: 30, active: false });

    const [taxAudit] = await db
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.action, "customs.tax.status")),
      );
    expect(taxAudit?.value).toBe(1);
  });

  it("refuse une déclaration avec un bureau désactivé ou un tiers inactif", async () => {
    const ids = await seedCustomsTenant(db, "cus001-refus");

    await setCustomsOfficeActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      officeId: ids.officeId,
      active: false,
    });

    await expect(createDraft(ids)).rejects.toThrow(/bureau choisi est désactivé/);

    await setCustomsOfficeActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      officeId: ids.officeId,
      active: true,
    });

    await expect(createDraft(ids, { partnerId: ids.inactivePartnerId })).rejects.toThrow(
      /tiers déclaré est inactif/,
    );
  });
});

describe("CUS-002 — cycle de vie de la déclaration", () => {
  it("crée un brouillon numéroté et exige au moins une ligne avant le dépôt", async () => {
    const ids = await seedCustomsTenant(db, "cus002");
    const created = await createDraft(ids, { reference: "SYDONIA-1" });

    expect(created.number).toMatch(/^DEC-2026-\d{4}$/);
    expect((await detail(ids, created.id)).status).toBe("draft");

    await expect(transition(ids, created.id, "deposit")).rejects.toThrow(/au moins une ligne/);
    await expect(transition(ids, created.id, "clear")).rejects.toThrow(/Transition refusée/);

    await addLine(ids, created.id);
    await transition(ids, created.id, "deposit");
    expect((await detail(ids, created.id)).status).toBe("deposited");
  });

  it("bloque toute mutation d'en-tête ou de ligne hors brouillon", async () => {
    const ids = await seedCustomsTenant(db, "cus002-mutations");
    const created = await createDraft(ids);
    const lineId = await addLine(ids, created.id);
    await transition(ids, created.id, "deposit");

    await expect(
      updateDeclarationHeader(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: created.id,
        raw: {
          regimeId: ids.plainRegimeId,
          officeId: ids.officeId,
          partnerId: ids.partnerId,
          declarationDate: "2026-10-16",
          externalReference: "",
          freightAmountXof: "0",
          insuranceAmountXof: "0",
        },
      }),
    ).rejects.toThrow(/brouillon/);

    await expect(addLine(ids, created.id)).rejects.toThrow(/brouillon/);

    await expect(
      removeDeclarationLine(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: created.id,
        lineId,
      }),
    ).rejects.toThrow(/brouillon/);
  });

  it("annule une déclaration déposée sans paiement puis refuse toute suite", async () => {
    const ids = await seedCustomsTenant(db, "cus002-annule");
    const created = await createDraft(ids);
    await addLine(ids, created.id);
    await transition(ids, created.id, "deposit");
    await transition(ids, created.id, "cancel");

    const cancelled = await detail(ids, created.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();

    await expect(transition(ids, created.id, "deposit")).rejects.toThrow(/Transition refusée/);
    await expect(transition(ids, created.id, "liquidate")).rejects.toThrow(/Transition refusée/);
  });

  it("retire une ligne d'un brouillon et renseigne le prochain numéro", async () => {
    const ids = await seedCustomsTenant(db, "cus002-lignes");
    const created = await createDraft(ids);
    const first = await addLine(ids, created.id, { designation: "Première" });
    await addLine(ids, created.id, { designation: "Deuxième" });

    await removeDeclarationLine(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: created.id,
      lineId: first,
    });

    const third = await addLine(ids, created.id, { designation: "Troisième" });
    expect(third).toBeTruthy();
    const lines = (await detail(ids, created.id)).lines;
    expect(lines.map((line) => [line.lineNumber, line.designation])).toEqual([
      [2, "Deuxième"],
      [3, "Troisième"],
    ]);
  });
});

describe("CUS-003 — liquidation", () => {
  it("fige CIF, droits TEC, taxes et totaux dans un instantané", async () => {
    const ids = await seedCustomsTenant(db, "cus003");
    const created = await createDraft(ids, { freight: 300_000, insurance: 30_000 });
    await addLine(ids, created.id, { value: 1_000_000, hsCode: ids.hsCode });
    await addLine(ids, created.id, {
      value: 2_000_000,
      hsCode: ids.secondHsCode,
      designation: "Sucre blanc",
    });

    await transition(ids, created.id, "deposit");
    await transition(ids, created.id, "liquidate");

    const declaration = await detail(ids, created.id);
    expect(declaration.status).toBe("liquidated");
    expect(declaration.liquidatedAt).not.toBeNull();
    expect(declaration.cifTotal).toBe(3_330_000);
    expect(declaration.dutyTotal).toBe(555_000);
    expect(declaration.taxTotal).toBe(732_600);
    expect(declaration.grandTotal).toBe(1_287_600);

    expect(
      declaration.lines.map((line) => [
        line.lineNumber,
        line.cifValue,
        line.dutyRate,
        line.dutyAmount,
      ]),
    ).toEqual([
      [1, 1_110_000, 10, 111_000],
      [2, 2_220_000, 20, 444_000],
    ]);

    expect(
      declaration.taxes.map((tax) => [tax.code, tax.base, tax.baseAmount, tax.rateBp, tax.amount]),
    ).toEqual([
      ["PCS", "cif", 3_330_000, 100, 33_300],
      ["TVA", "cif_plus_duty", 3_885_000, 1800, 699_300],
    ]);
  });

  it("refuse la liquidation quand un taux TEC manque et laisse le statut intact", async () => {
    const ids = await seedCustomsTenant(db, "cus003-tec");
    const created = await createDraft(ids);
    await addLine(ids, created.id, { hsCode: ids.missingTecHsCode });
    await transition(ids, created.id, "deposit");

    await expect(transition(ids, created.id, "liquidate")).rejects.toThrow(/TEC manquant/);

    const declaration = await detail(ids, created.id);
    expect(declaration.status).toBe("deposited");
    expect(declaration.grandTotal).toBe(0);
    expect(declaration.lines[0]?.dutyRate).toBeNull();
  });

  it("applique un taux TEC nul sans droit", async () => {
    const ids = await seedCustomsTenant(db, "cus003-zero");
    const created = await createDraft(ids);
    await addLine(ids, created.id, { hsCode: ids.zeroHsCode, value: 500_000 });
    await transition(ids, created.id, "deposit");
    await transition(ids, created.id, "liquidate");

    const declaration = await detail(ids, created.id);
    expect(declaration.lines[0]).toMatchObject({ dutyRate: 0, dutyAmount: 0 });
    expect(declaration.dutyTotal).toBe(0);
    expect(declaration.grandTotal).toBe(declaration.taxTotal);
  });
});

describe("CUS-004 — acquit-à-caution et apurement", () => {
  it("exige une garantie suffisante, un seul acquit et un apurement unique", async () => {
    const ids = await seedCustomsTenant(db, "cus004");
    const declaration = await liquidatedDeclaration(ids, { regimeId: ids.bondRegimeId });

    await expect(
      createBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: {
          guaranteeAmountXof: String(declaration.grandTotal - 1),
          guaranteeReference: "GAR-1",
        },
      }),
    ).rejects.toThrow(/Garantie insuffisante/);

    const bond = await createBond(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: { guaranteeAmountXof: String(declaration.grandTotal), guaranteeReference: "GAR-1" },
    });
    expect(bond.number).toMatch(/^AAC-\d{4}-\d{4}$/);

    await expect(
      createBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: { guaranteeAmountXof: String(declaration.grandTotal), guaranteeReference: "GAR-2" },
      }),
    ).rejects.toThrow(/existe déjà/);

    await expect(
      apureBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        bondId: bond.id,
        raw: { reference: "  " },
      }),
    ).rejects.toThrow(/obligatoire/);

    await apureBond(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      bondId: bond.id,
      raw: { reference: "APU-2026-1" },
    });

    const apured = await detail(ids, declaration.id);
    expect(apured.bond).toMatchObject({
      status: "apured",
      apurementReference: "APU-2026-1",
    });
    expect(apured.bond?.apuredAt).not.toBeNull();

    await expect(
      apureBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        bondId: bond.id,
        raw: { reference: "APU-2026-2" },
      }),
    ).rejects.toThrow(/déjà apuré/);
  });

  it("refuse un acquit sur un régime sans garantie ou avant la liquidation", async () => {
    const ids = await seedCustomsTenant(db, "cus004-refus");
    const plain = await liquidatedDeclaration(ids);

    await expect(
      createBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: plain.id,
        raw: { guaranteeAmountXof: String(plain.grandTotal), guaranteeReference: "GAR-3" },
      }),
    ).rejects.toThrow(/ne prévoit pas/);

    const draft = await createDraft(ids, { regimeId: ids.bondRegimeId });
    await addLine(ids, draft.id);
    await transition(ids, draft.id, "deposit");

    await expect(
      createBond(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: draft.id,
        raw: { guaranteeAmountXof: "1000000", guaranteeReference: "GAR-4" },
      }),
    ).rejects.toThrow(/après la liquidation/);
  });

  it("refuse l'annulation d'une déclaration dont l'acquit est ouvert", async () => {
    const ids = await seedCustomsTenant(db, "cus004-annule");
    const declaration = await liquidatedDeclaration(ids, { regimeId: ids.bondRegimeId });

    await createBond(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: { guaranteeAmountXof: String(declaration.grandTotal), guaranteeReference: "GAR-5" },
    });

    await expect(transition(ids, declaration.id, "cancel")).rejects.toThrow(
      /acquit-à-caution est encore ouvert/,
    );
  });
});

describe("CUS-005 — paiements et mainlevée", () => {
  it("refuse les paiements hors liquidation, excédentaires, futurs ou non entiers", async () => {
    const ids = await seedCustomsTenant(db, "cus005-refus");
    const draft = await createDraft(ids);
    await addLine(ids, draft.id);

    await expect(
      recordCustomsPayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: draft.id,
        raw: { amountXof: "1000", method: "transfer", paidDate: todayIsoDate(), reference: "" },
      }),
    ).rejects.toThrow(/liquidée/);

    const declaration = await liquidatedDeclaration(ids);

    await expect(
      recordCustomsPayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: {
          amountXof: String(declaration.grandTotal + 1),
          method: "transfer",
          paidDate: todayIsoDate(),
          reference: "",
        },
      }),
    ).rejects.toThrow(/dépasse le reste/);

    await expect(
      recordCustomsPayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: {
          amountXof: "1000",
          method: "transfer",
          paidDate: addDays(todayIsoDate(), 1),
          reference: "",
        },
      }),
    ).rejects.toThrow(/aujourd'hui au plus tard/);

    await expect(
      recordCustomsPayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: { amountXof: "12,5", method: "transfer", paidDate: todayIsoDate(), reference: "" },
      }),
    ).rejects.toThrow(CustomsError);
  });

  it("cumule les paiements append-only puis accorde la mainlevée au solde zéro", async () => {
    const ids = await seedCustomsTenant(db, "cus005-mainlevee");
    const declaration = await liquidatedDeclaration(ids);
    const partial = 100_000;
    const balance = declaration.grandTotal - partial;

    await recordCustomsPayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: {
        amountXof: String(partial),
        method: "transfer",
        paidDate: todayIsoDate(),
        reference: "VIR-1",
      },
    });

    let current = await detail(ids, declaration.id);
    expect(current.paidTotal).toBe(partial);

    await expect(transition(ids, declaration.id, "clear")).rejects.toThrow(
      /pas intégralement réglé/,
    );

    await recordCustomsPayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: {
        amountXof: String(balance),
        method: "cash",
        paidDate: todayIsoDate(),
        reference: "ESP-1",
      },
    });

    current = await detail(ids, declaration.id);
    expect(current.paidTotal).toBe(declaration.grandTotal);
    expect(current.payments.map((payment) => payment.amount)).toEqual([partial, balance]);

    await transition(ids, declaration.id, "clear");
    const cleared = await detail(ids, declaration.id);
    expect(cleared.status).toBe("cleared");
    expect(cleared.clearedAt).not.toBeNull();

    await expect(
      recordCustomsPayment(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: declaration.id,
        raw: { amountXof: "1", method: "cash", paidDate: todayIsoDate(), reference: "" },
      }),
    ).rejects.toThrow(/liquidée/);

    await expect(transition(ids, declaration.id, "cancel")).rejects.toThrow(/Transition refusée/);
  });

  it("refuse la mainlevée tant que l'acquit exigé n'est pas apuré", async () => {
    const ids = await seedCustomsTenant(db, "cus005-acquit");
    const declaration = await liquidatedDeclaration(ids, { regimeId: ids.bondRegimeId });

    const bond = await createBond(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: { guaranteeAmountXof: String(declaration.grandTotal), guaranteeReference: "GAR-6" },
    });

    await recordCustomsPayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: {
        amountXof: String(declaration.grandTotal),
        method: "transfer",
        paidDate: todayIsoDate(),
        reference: "VIR-2",
      },
    });

    await expect(transition(ids, declaration.id, "clear")).rejects.toThrow(
      /acquit-à-caution apuré/,
    );

    await apureBond(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      bondId: bond.id,
      raw: { reference: "APU-2026-3" },
    });

    await transition(ids, declaration.id, "clear");
    expect((await detail(ids, declaration.id)).status).toBe("cleared");
  });

  it("refuse l'annulation dès qu'un paiement est enregistré", async () => {
    const ids = await seedCustomsTenant(db, "cus005-annule");
    const declaration = await liquidatedDeclaration(ids);

    await recordCustomsPayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: { amountXof: "1000", method: "transfer", paidDate: todayIsoDate(), reference: "" },
    });

    await expect(transition(ids, declaration.id, "cancel")).rejects.toThrow(
      /paiements sont déjà enregistrés/,
    );
  });

  it("laisse une trace d'audit pour chaque paiement", async () => {
    const ids = await seedCustomsTenant(db, "cus005-audit");
    const declaration = await liquidatedDeclaration(ids);

    await recordCustomsPayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: declaration.id,
      raw: {
        amountXof: "5000",
        method: "mobile_money",
        paidDate: todayIsoDate(),
        reference: "MM-1",
      },
    });

    const rows = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, ids.tenantId))
      .orderBy(asc(auditEvents.createdAt));
    expect(rows.some((row) => row.action === "customs.payment.create")).toBe(true);
  });
});
