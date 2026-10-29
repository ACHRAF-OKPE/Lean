import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, customsDeclarations } from "@/db/schema";
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
  createDeclarationWithRegime,
  getDeclaration,
  listCustomsReferentials,
  listApurementOverviews,
  recordApurement,
  recordCustomsPayment,
  removeDeclarationLine,
  setCustomsOfficeActive,
  setCustomsRegimeActive,
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
  options: {
    hsCode?: string;
    value?: number;
    designation?: string;
    quantity?: string;
    unitCode?: string;
  } = {},
): Promise<string> {
  const created = await addDeclarationLine(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    declarationId,
    raw: {
      hsCode: options.hsCode ?? ids.hsCode,
      designation: options.designation ?? "Marchandise déclarée",
      quantity: options.quantity ?? "10",
      unitCode: options.unitCode ?? "KG",
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
    expect(referentials.regimes.map((regime) => regime.code)).toEqual(["IM4", "IM8", "IM9"]);
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

describe("CUS-007 — apurement progressif des sommiers IM9", () => {
  async function liquidatedIm9(
    ids: CustomsTenant,
    options: { quantity?: string; unitCode?: string } = {},
  ): Promise<{ id: string; lineId: string }> {
    const created = await createDraft(ids, { regimeId: ids.im9RegimeId });
    const lineId = await addLine(ids, created.id, {
      quantity: options.quantity ?? "10",
      unitCode: options.unitCode ?? "KG",
    });
    await transition(ids, created.id, "deposit");
    await transition(ids, created.id, "liquidate");
    return { id: created.id, lineId };
  }

  function apurementRaw(lineId: string, quantity: string, reference: string, mode = "production") {
    return { lineId, quantity, apuredDate: todayIsoDate(), mode, reference };
  }

  it("refuse l'apurement hors régime IM9 ou avant la liquidation", async () => {
    const ids = await seedCustomsTenant(db, "cus007-refus");
    const plain = await liquidatedDeclaration(ids);
    const plainLine = (await detail(ids, plain.id)).lines[0]!;

    await expect(
      recordApurement(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: plain.id,
        raw: apurementRaw(plainLine.id, "1", "PROD-0"),
      }),
    ).rejects.toThrow(/ne prévoit pas d'apurement progressif/);

    const draft = await createDraft(ids, { regimeId: ids.im9RegimeId });
    const draftLine = await addLine(ids, draft.id);

    await expect(
      recordApurement(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: draft.id,
        raw: apurementRaw(draftLine, "1", "PROD-0"),
      }),
    ).rejects.toThrow(/doit être liquidée/);
  });

  it("apure par écritures successives sans jamais dépasser le restant", async () => {
    const ids = await seedCustomsTenant(db, "cus007-im9");
    const { id, lineId } = await liquidatedIm9(ids);

    const first = await recordApurement(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: id,
      raw: apurementRaw(lineId, "4", "PROD-1"),
    });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);

    let current = await detail(ids, id);
    expect(current.apurement).toMatchObject({
      state: "partial",
      lineCount: 1,
      apuredLineCount: 0,
      partialLineCount: 1,
      unitCode: "KG",
      apuredQuantity: "4",
      remainingQuantity: "6",
      averageRateBp: 4000,
    });
    expect(current.lines[0]).toMatchObject({
      apuredQuantity: "4",
      remainingQuantity: "6",
      apurementRateBp: 4000,
      apurementState: "partial",
    });

    await expect(
      recordApurement(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        declarationId: id,
        raw: apurementRaw(lineId, "7", "PROD-TROP"),
      }),
    ).rejects.toThrow(/dépasse le restant/);

    await recordApurement(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: id,
      raw: apurementRaw(lineId, "6", "EXP-2", "export"),
    });

    current = await detail(ids, id);
    expect(current.apurement).toMatchObject({
      state: "apured",
      apuredLineCount: 1,
      partialLineCount: 0,
      apuredQuantity: "10",
      remainingQuantity: "0",
      averageRateBp: 10000,
    });
    expect(current.lines[0]).toMatchObject({
      apurementState: "apured",
      remainingQuantity: "0",
      apurementRateBp: 10000,
    });
    expect(
      current.apurementEntries.map((entry) => [
        entry.lineNumber,
        entry.quantity,
        entry.mode,
        entry.reference,
      ]),
    ).toEqual([
      [1, "4.000000", "production", "PROD-1"],
      [1, "6.000000", "export", "EXP-2"],
    ]);

    const [audit] = await db
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "customs.apurement.create"),
        ),
      );
    expect(audit?.value).toBe(2);
  });

  it("signale les unités mixtes, bloque l'annulation et alimente le sommier", async () => {
    const ids = await seedCustomsTenant(db, "cus007-sommier");
    const created = await createDraft(ids, { regimeId: ids.im9RegimeId });
    const kgLine = await addLine(ids, created.id, { quantity: "10", unitCode: "KG" });
    await addLine(ids, created.id, { quantity: "5", unitCode: "PCE" });
    await transition(ids, created.id, "deposit");
    await transition(ids, created.id, "liquidate");

    await recordApurement(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      declarationId: created.id,
      raw: apurementRaw(kgLine, "10", "PROD-3"),
    });

    const current = await detail(ids, created.id);
    expect(current.apurement).toMatchObject({
      state: "partial",
      lineCount: 2,
      apuredLineCount: 1,
      partialLineCount: 0,
      unitCode: null,
      apuredQuantity: null,
      remainingQuantity: null,
    });

    await expect(transition(ids, created.id, "cancel")).rejects.toThrow(
      /apurements progressifs sont déjà enregistrés/,
    );

    const overview = await listApurementOverviews(db, ids.tenantId);
    const row = overview.find((entry) => entry.id === created.id);
    expect(row).toMatchObject({
      number: created.number,
      regimeCode: "IM9",
      status: "liquidated",
    });
    expect(row?.progress.state).toBe("partial");
    expect(row?.progress.unitCode).toBeNull();
  });
});

describe("CUS-011 — régime saisi à la volée", () => {
  const newRegime = {
    code: "im5",
    label: "Admission temporaire — apurement progressif",
    kind: "suspensive",
    requiresBond: false,
    requiresApurement: true,
  };

  function headerRaw(ids: CustomsTenant) {
    return {
      officeId: ids.officeId,
      partnerId: ids.partnerId,
      declarationDate: "2026-10-20",
      externalReference: "",
      freightAmountXof: 0,
      insuranceAmountXof: 0,
    };
  }

  async function declarationCount(tenantId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(customsDeclarations)
      .where(eq(customsDeclarations.tenantId, tenantId));
    return row?.value ?? 0;
  }

  it("crée le régime absent, l'ajoute au référentiel et l'applique à la déclaration", async () => {
    const ids = await seedCustomsTenant(db, "cus011-create");
    const before = await listCustomsReferentials(db, ids.tenantId);

    const created = await createDeclarationWithRegime(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      regimeRaw: newRegime,
      raw: headerRaw(ids),
    });

    const after = await listCustomsReferentials(db, ids.tenantId);
    expect(after.regimes).toHaveLength(before.regimes.length + 1);
    const regime = after.regimes.find((row) => row.code === "IM5");
    expect(regime).toMatchObject({
      label: "Admission temporaire — apurement progressif",
      kind: "suspensive",
      requiresBond: false,
      requiresApurement: true,
      active: true,
    });
    expect(created.regimeId).toBe(regime?.id ?? "");

    const declaration = await detail(ids, created.id);
    expect(declaration).toMatchObject({
      number: created.number,
      regimeCode: "IM5",
      requiresApurement: true,
      status: "draft",
    });
    expect(await declarationCount(ids.tenantId)).toBe(1);

    const audits = await db
      .select({ action: auditEvents.action, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ids.tenantId), eq(auditEvents.entityId, regime?.id ?? "")),
      );
    const regimeAudit = audits.find((row) => row.action === "customs.regime.create");
    expect(regimeAudit?.details).toMatchObject({ code: "IM5", source: "declaration" });
  });

  it("réutilise un code déjà présent et actif sans créer de doublon", async () => {
    const ids = await seedCustomsTenant(db, "cus011-reuse");
    const before = await listCustomsReferentials(db, ids.tenantId);

    const created = await createDeclarationWithRegime(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      regimeRaw: {
        code: "IM4",
        label: "Libellé ignoré au profit du référentiel",
        kind: "export",
        requiresBond: true,
        requiresApurement: true,
      },
      raw: headerRaw(ids),
    });

    const after = await listCustomsReferentials(db, ids.tenantId);
    expect(after.regimes).toHaveLength(before.regimes.length);
    expect(created.regimeId).toBe(ids.plainRegimeId);
    expect((await detail(ids, created.id)).regimeCode).toBe("IM4");

    const [audit] = await db
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.action, "customs.regime.create"),
        ),
      );
    expect(audit?.value).toBe(0);
  });

  it("refuse un code existant désactivé ou un régime invalide sans écrire de déclaration", async () => {
    const ids = await seedCustomsTenant(db, "cus011-refus");
    await setCustomsRegimeActive(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      regimeId: ids.bondRegimeId,
      active: false,
    });
    const before = await listCustomsReferentials(db, ids.tenantId);

    await expect(
      createDeclarationWithRegime(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        regimeRaw: { code: "IM8", label: "Transit", kind: "transit", requiresBond: false },
        raw: headerRaw(ids),
      }),
    ).rejects.toThrow(/existe déjà mais est désactivé/);

    await expect(
      createDeclarationWithRegime(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        regimeRaw: { code: "I", label: "", kind: "inconnu", requiresBond: false },
        raw: headerRaw(ids),
      }),
    ).rejects.toThrow(CustomsError);

    expect((await listCustomsReferentials(db, ids.tenantId)).regimes).toHaveLength(
      before.regimes.length,
    );
    expect(await declarationCount(ids.tenantId)).toBe(0);
  });

  it("cloisonne le code de régime par espace", async () => {
    const first = await seedCustomsTenant(db, "cus011-espace-a");
    const second = await seedCustomsTenant(db, "cus011-espace-b");

    const a = await createDeclarationWithRegime(db, {
      tenantId: first.tenantId,
      actorUserId: first.userId,
      regimeRaw: newRegime,
      raw: headerRaw(first),
    });
    const b = await createDeclarationWithRegime(db, {
      tenantId: second.tenantId,
      actorUserId: second.userId,
      regimeRaw: newRegime,
      raw: headerRaw(second),
    });

    expect(a.regimeId).not.toBe(b.regimeId);
    const firstRegimes = await listCustomsReferentials(db, first.tenantId);
    expect(firstRegimes.regimes.filter((row) => row.code === "IM5")).toHaveLength(1);
  });
});
