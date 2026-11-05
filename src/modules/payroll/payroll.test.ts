import { and, asc, eq } from "drizzle-orm";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents, journalEntries, journalEntryLines, ledgerAccounts } from "@/db/schema";
import { createContract, createEmployee, startContract } from "@/modules/hr/queries";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { enablePayrollAccounting } from "@/test/accounting";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import {
  createPayrollComponent,
  listPayrollComponents,
  setPayrollComponentActive,
  updatePayrollComponent,
} from "./components";
import { MAX_PAYSLIP_AMOUNT_XOF } from "./constants";
import { PayrollError } from "./errors";
import {
  buildPayrollPayslipsExport,
  payrollPayslipsExportFileName,
  type PayrollPayslipExportRow,
} from "./exports";
import {
  createPayrollPeriod,
  listPayrollPeriods,
  payrollPaymentDate,
  validatePayrollPeriod,
} from "./periods";
import {
  computePayslip,
  deletePayrollPayslip,
  generatePayrollPayslips,
  getPayrollPayslip,
  listPayrollPayslips,
  validatePayrollPayslip,
} from "./payslips";
import { getPayrollOverview } from "./queries";
import { getPayrollSettingsView, loadPayrollSettings, savePayrollSettings } from "./settings";

let test: TestDatabase;
let db: Database;
let tenant: HrTenant;
let otherTenantId: string;

beforeAll(async () => {
  test = await createTestDatabase();
  db = test.db;
  tenant = await seedHrTenant(db, "payroll");
  otherTenantId = tenant.otherTenantId;
});

afterAll(async () => {
  await test.close();
});

async function auditActions(entityId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenant.tenantId), eq(auditEvents.entityId, entityId)));
  return rows.map((row) => row.action);
}

/* ------------------------------------------------------------------------- PAY-001 */

describe("PAY-001 — paramétrage unique par espace", () => {
  it("rend l'absence de paramétrage sans inventer de ligne", async () => {
    expect(await loadPayrollSettings(db, tenant.tenantId)).toBeNull();
    expect(await getPayrollSettingsView(db, tenant.tenantId)).toBeNull();
  });

  it("crée puis met à jour la ligne, avec un taux décimal à la virgule acceptée", async () => {
    const first = await savePayrollSettings(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { paymentDayOfMonth: "30", socialEmployeeRate: "5,5", socialEmployerRate: "16" },
    });
    expect(first.created).toBe(true);
    expect(await loadPayrollSettings(db, tenant.tenantId)).toMatchObject({
      paymentDayOfMonth: 30,
      socialEmployeeRate: "5.5",
      socialEmployerRate: "16",
    });

    const second = await savePayrollSettings(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { paymentDayOfMonth: "28", socialEmployeeRate: "6", socialEmployerRate: "18,25" },
    });
    expect(second.created).toBe(false);

    const view = await getPayrollSettingsView(db, tenant.tenantId);
    expect(view).toMatchObject({
      paymentDayOfMonth: 28,
      socialEmployeeRate: "6",
      socialEmployerRate: "18.25",
    });
  });

  it("refuse un jour de paiement hors 1 à 31 et un taux hors 0 à 100", async () => {
    await expect(
      savePayrollSettings(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { paymentDayOfMonth: "0", socialEmployeeRate: "5", socialEmployerRate: "16" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
    await expect(
      savePayrollSettings(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { paymentDayOfMonth: "ab", socialEmployeeRate: "5", socialEmployerRate: "16" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
    await expect(
      savePayrollSettings(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { paymentDayOfMonth: "28", socialEmployeeRate: "120", socialEmployerRate: "16" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("isole le paramétrage d'un espace de celui du voisin", async () => {
    expect(await loadPayrollSettings(db, otherTenantId)).toBeNull();
    await savePayrollSettings(db, {
      tenantId: otherTenantId,
      actorUserId: tenant.otherTenantUserId,
      raw: { paymentDayOfMonth: "25", socialEmployeeRate: "1", socialEmployerRate: "2" },
    });
    expect((await loadPayrollSettings(db, tenant.tenantId))?.paymentDayOfMonth).toBe(28);
    expect((await loadPayrollSettings(db, otherTenantId))?.paymentDayOfMonth).toBe(25);
  });
});

/* ------------------------------------------------------------------------- PAY-003 */

describe("PAY-003 — registre des rubriques", () => {
  it("normalise le code en majuscules et trie le registre par code", async () => {
    await createPayrollComponent(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        code: "prime anc",
        label: "Prime d'ancienneté",
        kind: "earning",
        mode: "fixed",
        amountXof: "25000",
        ratePercent: "",
        taxable: true,
      },
    });
    await createPayrollComponent(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        code: "cnps_sal",
        label: "Cotisation salariale",
        kind: "deduction",
        mode: "percent",
        amountXof: "",
        ratePercent: "5.5",
        taxable: false,
      },
    });

    const components = await listPayrollComponents(db, tenant.tenantId);
    expect(components.map((component) => component.code)).toEqual(["CNPS_SAL", "PRIME_ANC"]);
    const prime = components.find((component) => component.code === "PRIME_ANC");
    expect(prime).toMatchObject({ kind: "earning", mode: "fixed", amountXof: 25000 });
    const cnps = components.find((component) => component.code === "CNPS_SAL");
    expect(cnps).toMatchObject({ mode: "percent", ratePercent: "5.5" });
  });

  it("refuse un code en doublon, un code mal formé, un libellé vide et une valeur nulle", async () => {
    await expect(
      createPayrollComponent(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          code: "PRIME_ANC",
          label: "Doublon",
          kind: "earning",
          mode: "fixed",
          amountXof: "10",
          ratePercent: "",
          taxable: true,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollError);

    await expect(
      createPayrollComponent(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          code: "@@",
          label: "Code invalide",
          kind: "earning",
          mode: "fixed",
          amountXof: "10",
          ratePercent: "",
          taxable: true,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollError);

    await expect(
      createPayrollComponent(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          code: "VIDE",
          label: "",
          kind: "earning",
          mode: "fixed",
          amountXof: "10",
          ratePercent: "",
          taxable: true,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollError);

    await expect(
      createPayrollComponent(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          code: "ZERO_FIXE",
          label: "Montant nul",
          kind: "earning",
          mode: "fixed",
          amountXof: "0",
          ratePercent: "",
          taxable: true,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollError);

    await expect(
      createPayrollComponent(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: {
          code: "ZERO_TAUX",
          label: "Taux nul",
          kind: "deduction",
          mode: "percent",
          amountXof: "",
          ratePercent: "0",
          taxable: true,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("corrige le libellé et la valeur sans changer le code", async () => {
    const [prime] = (await listPayrollComponents(db, tenant.tenantId)).filter(
      (component) => component.code === "PRIME_ANC",
    );
    expect(prime).toBeDefined();
    await updatePayrollComponent(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      componentId: prime!.id,
      raw: {
        label: "Prime d'ancienneté révisée",
        amountXof: "30000",
        ratePercent: "",
        taxable: true,
      },
    });
    const after = (await listPayrollComponents(db, tenant.tenantId)).find(
      (component) => component.code === "PRIME_ANC",
    );
    expect(after).toMatchObject({ label: "Prime d'ancienneté révisée", amountXof: 30000 });
    await expect(auditActions(prime!.id)).resolves.toContain("payroll.component.update");
  });

  it("isole le registre d'un espace de celui du voisin", async () => {
    expect(await listPayrollComponents(db, otherTenantId)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- PAY-004 */

describe("PAY-004 — désactivation d'une rubrique", () => {
  it("bascule l'état, trace l'évènement et ne fait rien si l'état ne change pas", async () => {
    const cnps = (await listPayrollComponents(db, tenant.tenantId)).find(
      (component) => component.code === "CNPS_SAL",
    );
    expect(cnps).toBeDefined();

    await setPayrollComponentActive(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      componentId: cnps!.id,
      active: false,
    });
    const inactive = (await listPayrollComponents(db, tenant.tenantId)).find(
      (component) => component.code === "CNPS_SAL",
    );
    expect(inactive?.active).toBe(false);
    await expect(auditActions(cnps!.id)).resolves.toContain("payroll.component.deactivate");

    await setPayrollComponentActive(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      componentId: cnps!.id,
      active: true,
    });
    expect(
      (await listPayrollComponents(db, tenant.tenantId)).find(
        (component) => component.code === "CNPS_SAL",
      )?.active,
    ).toBe(true);
    await expect(auditActions(cnps!.id)).resolves.toContain("payroll.component.activate");
  });

  it("refuse une rubrique hors espace", async () => {
    await expect(
      setPayrollComponentActive(db, {
        tenantId: otherTenantId,
        actorUserId: tenant.otherTenantUserId,
        componentId: "00000000-0000-0000-0000-000000000000",
        active: false,
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });
});

/* ------------------------------------------------------------------------- PAY-002 */

describe("PAY-002 — hub de la paie", () => {
  it("compte les contrats en cours et les rubriques actives, recalculés à la lecture", async () => {
    const employee = await createEmployee(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        code: "SAL001",
        lastName: "Ndiaye",
        firstName: "Awa",
        hireDate: "2024-01-01",
      },
    });
    const contract = await createContract(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: {
        employeeId: employee.id,
        kind: "cdi",
        startDate: "2024-01-01",
        salaryXof: "250000",
      },
    });
    await startContract(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      contractId: contract.id,
    });

    await setPayrollComponentActive(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      componentId: (await listPayrollComponents(db, tenant.tenantId)).find(
        (component) => component.code === "CNPS_SAL",
      )!.id,
      active: false,
    });

    const overview = await getPayrollOverview(db, tenant.tenantId);
    expect(overview).toEqual({ runningContracts: 1, activeComponents: 1, draftPeriods: 0 });
    expect(await getPayrollOverview(db, otherTenantId)).toEqual({
      runningContracts: 0,
      activeComponents: 0,
      draftPeriods: 0,
    });
  });
});

/* ------------------------------------------------------------------------- PAY-005 */

describe("PAY-005 — périodes de paie", () => {
  it("refuse une année hors bornes et un mois hors 1 à 12", async () => {
    await expect(
      createPayrollPeriod(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { year: "1999", month: "1" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
    await expect(
      createPayrollPeriod(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { year: "2026", month: "13" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
    await expect(
      createPayrollPeriod(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { year: "vingt", month: "1" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("ouvre un mois, le libelle et ordonne le registre du plus récent au plus ancien", async () => {
    await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "1" },
    });
    await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "2" },
    });

    const periods = await listPayrollPeriods(db, tenant.tenantId);
    expect(periods.map((period) => period.label)).toEqual(["Février 2026", "Janvier 2026"]);
    expect(periods.every((period) => period.status === "draft")).toBe(true);
    expect((await getPayrollOverview(db, tenant.tenantId)).draftPeriods).toBe(2);
  });

  it("refuse d'ouvrir deux fois le même mois", async () => {
    await expect(
      createPayrollPeriod(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        raw: { year: "2026", month: "1" },
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("valide une période une seule fois, trace l'audit et sort du compteur de brouillons", async () => {
    const [february] = (await listPayrollPeriods(db, tenant.tenantId)).filter(
      (period) => period.month === 2,
    );
    expect(february).toBeDefined();

    const first = await validatePayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: february!.id,
    });
    expect(first.changed).toBe(true);

    const [validated] = (await listPayrollPeriods(db, tenant.tenantId)).filter(
      (period) => period.id === february!.id,
    );
    expect(validated?.status).toBe("validated");
    expect(validated?.validatedAt).not.toBeNull();
    expect((await getPayrollOverview(db, tenant.tenantId)).draftPeriods).toBe(1);
    await expect(auditActions(february!.id)).resolves.toContain("payroll.period.validate");

    const second = await validatePayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: february!.id,
    });
    expect(second.changed).toBe(false);
    const validations = (await auditActions(february!.id)).filter(
      (action) => action === "payroll.period.validate",
    );
    expect(validations).toHaveLength(1);
  });

  it("refuse une période hors espace", async () => {
    await expect(
      validatePayrollPeriod(db, {
        tenantId: otherTenantId,
        actorUserId: tenant.otherTenantUserId,
        periodId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("isole les périodes d'un espace de celles du voisin", async () => {
    expect(await listPayrollPeriods(db, otherTenantId)).toHaveLength(0);
  });

  it("ramène la date de paiement au dernier jour du mois quand il est plus court", () => {
    expect(payrollPaymentDate(2026, 1, 31)).toBe("2026-01-31");
    expect(payrollPaymentDate(2026, 2, 31)).toBe("2026-02-28");
    expect(payrollPaymentDate(2024, 2, 31)).toBe("2024-02-29");
    expect(payrollPaymentDate(2026, 4, 31)).toBe("2026-04-30");
    expect(payrollPaymentDate(2026, 3, 28)).toBe("2026-03-28");
  });
});

async function addRunningEmployee(code: string, salaryXof: string): Promise<string> {
  const employee = await createEmployee(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: { code, lastName: "Diop", firstName: "Moussa", hireDate: "2024-01-01" },
  });
  const contract = await createContract(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    raw: { employeeId: employee.id, kind: "cdi", startDate: "2024-01-01", salaryXof },
  });
  await startContract(db, {
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    contractId: contract.id,
  });
  return employee.id;
}

/* ------------------------------------------------------------------------- PAY-006 */

describe("PAY-006 — bulletins de paie", () => {
  it("calcule le brut, les cotisations et le net d'un bulletin", () => {
    const result = computePayslip({
      baseSalaryXof: 300000,
      components: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          code: "PRIME",
          label: "Prime",
          kind: "earning",
          mode: "fixed",
          amountXof: 50000,
          ratePercent: "0",
          taxable: true,
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          code: "AVANCE",
          label: "Avance",
          kind: "deduction",
          mode: "percent",
          amountXof: 0,
          ratePercent: "10",
          taxable: false,
        },
      ],
      socialEmployeeRate: "5.5",
      socialEmployerRate: "16",
    });

    expect(result.baseSalaryXof).toBe(300000);
    expect(result.lines.map((line) => line.amountXof)).toEqual([50000, 30000]);
    expect(result.grossXof).toBe(350000);
    expect(result.socialEmployeeXof).toBe(19250);
    expect(result.socialEmployerXof).toBe(56000);
    expect(result.deductionsXof).toBe(30000);
    expect(result.netXof).toBe(300750);
  });

  it("refuse un brut au-delà du plafond et un net négatif", () => {
    expect(() =>
      computePayslip({
        baseSalaryXof: MAX_PAYSLIP_AMOUNT_XOF + 1,
        components: [],
        socialEmployeeRate: "0",
        socialEmployerRate: "0",
      }),
    ).toThrow(PayrollError);

    expect(() =>
      computePayslip({
        baseSalaryXof: 100000,
        components: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            code: "RETENUE",
            label: "Retenue",
            kind: "deduction",
            mode: "fixed",
            amountXof: 200000,
            ratePercent: "0",
            taxable: false,
          },
        ],
        socialEmployeeRate: "0",
        socialEmployerRate: "0",
      }),
    ).toThrow(PayrollError);
  });

  it("génère un bulletin par contrat en cours, une seule fois, avec le détail des rubriques", async () => {
    const employeeId = await addRunningEmployee("SAL100", "200000");
    const period = await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "4" },
    });

    const running = (await getPayrollOverview(db, tenant.tenantId)).runningContracts;
    const first = await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    expect(first.created).toBe(running);
    expect(first.skipped).toBe(0);

    const payslips = await listPayrollPayslips(db, tenant.tenantId, { periodId: period.id });
    expect(payslips).toHaveLength(running);
    const mine = payslips.find((payslip) => payslip.employeeId === employeeId);
    expect(mine).toMatchObject({
      employeeCode: "SAL100",
      status: "draft",
      periodLabel: "Avril 2026",
    });

    const detail = await getPayrollPayslip(db, tenant.tenantId, mine!.id);
    expect(detail?.baseSalaryXof).toBe(200000);
    expect(detail?.grossXof).toBeGreaterThan(200000);
    expect(detail?.lines.some((line) => line.code === "PRIME_ANC")).toBe(true);
    await expect(auditActions(mine!.id)).resolves.toContain("payroll.payslip.generate");

    const second = await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(running);
  });

  it("refuse de générer sur une période déjà validée", async () => {
    const [february] = (await listPayrollPeriods(db, tenant.tenantId)).filter(
      (item) => item.month === 2 && item.year === 2026,
    );
    await expect(
      generatePayrollPayslips(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        periodId: february!.id,
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("isole les bulletins d'un espace de ceux du voisin", async () => {
    expect(await listPayrollPayslips(db, otherTenantId)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- PAY-007 */

describe("PAY-007 — cycle de vie d'un bulletin", () => {
  it("valide un bulletin une seule fois et trace l'audit", async () => {
    const period = await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "5" },
    });
    await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    const [payslip] = await listPayrollPayslips(db, tenant.tenantId, { periodId: period.id });
    expect(payslip).toBeDefined();

    const first = await validatePayrollPayslip(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      payslipId: payslip!.id,
    });
    expect(first.changed).toBe(true);
    const detail = await getPayrollPayslip(db, tenant.tenantId, payslip!.id);
    expect(detail?.status).toBe("validated");
    expect(detail?.validatedAt).not.toBeNull();

    const second = await validatePayrollPayslip(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      payslipId: payslip!.id,
    });
    expect(second.changed).toBe(false);
    const validations = (await auditActions(payslip!.id)).filter(
      (action) => action === "payroll.payslip.validate",
    );
    expect(validations).toHaveLength(1);
  });

  it("refuse de figer une période tant qu'un bulletin reste en brouillon", async () => {
    const period = await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "6" },
    });
    await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });

    await expect(
      validatePayrollPeriod(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        periodId: period.id,
      }),
    ).rejects.toBeInstanceOf(PayrollError);

    for (const payslip of await listPayrollPayslips(db, tenant.tenantId, {
      periodId: period.id,
    })) {
      await validatePayrollPayslip(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        payslipId: payslip.id,
      });
    }

    const validated = await validatePayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    expect(validated.changed).toBe(true);
  });

  it("supprime un bulletin en brouillon mais refuse un bulletin validé", async () => {
    const period = await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "7" },
    });
    await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    const payslips = await listPayrollPayslips(db, tenant.tenantId, { periodId: period.id });
    expect(payslips.length).toBeGreaterThanOrEqual(2);

    await deletePayrollPayslip(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      payslipId: payslips[0]!.id,
    });
    await expect(auditActions(payslips[0]!.id)).resolves.toContain("payroll.payslip.delete");
    expect(await getPayrollPayslip(db, tenant.tenantId, payslips[0]!.id)).toBeNull();

    await validatePayrollPayslip(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      payslipId: payslips[1]!.id,
    });
    await expect(
      deletePayrollPayslip(db, {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        payslipId: payslips[1]!.id,
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });

  it("refuse un bulletin hors espace", async () => {
    const [payslip] = await listPayrollPayslips(db, tenant.tenantId);
    await expect(
      validatePayrollPayslip(db, {
        tenantId: otherTenantId,
        actorUserId: tenant.otherTenantUserId,
        payslipId: payslip!.id,
      }),
    ).rejects.toBeInstanceOf(PayrollError);
  });
});

/* ------------------------------------------------------------------------- PAY-008 */

describe("PAY-008 — export des bulletins", () => {
  it("nomme le classeur d'après la période filtrée, ou l'ensemble", () => {
    expect(payrollPayslipsExportFileName("Avril 2026")).toBe("bulletins-paie-avril-2026.xlsx");
    expect(payrollPayslipsExportFileName(null)).toBe("bulletins-paie-tous.xlsx");
  });

  it("exporte le registre à plat : colonnes, montants et total net", async () => {
    const rows: PayrollPayslipExportRow[] = [
      {
        employeeCode: "SAL100",
        employeeName: "DIOP Moussa",
        periodLabel: "Avril 2026",
        baseSalaryXof: 200000,
        grossXof: 230000,
        socialEmployeeXof: 13800,
        socialEmployerXof: 41975,
        deductionsXof: 0,
        netXof: 216200,
        status: "draft",
        validatedAt: null,
      },
      {
        employeeCode: "SAL001",
        employeeName: "DIALLO Amina",
        periodLabel: "Avril 2026",
        baseSalaryXof: 250000,
        grossXof: 280000,
        socialEmployeeXof: 16800,
        socialEmployerXof: 51100,
        deductionsXof: 0,
        netXof: 263200,
        status: "validated",
        validatedAt: new Date("2026-04-30T10:00:00Z"),
      },
    ];

    const bytes = await buildPayrollPayslipsExport(rows, "Avril 2026");
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    const sheet = workbook.getWorksheet("Bulletins");
    expect(sheet).toBeDefined();
    expect(sheet!.getCell("A1").value).toBe("Bulletins de paie");
    expect(sheet!.getCell("A4").value).toBe("Matricule");
    expect(sheet!.getCell("J4").value).toBe("Statut");

    expect(sheet!.getCell("A5").value).toBe("SAL100");
    expect(sheet!.getCell("I5").value).toBe(216200);
    expect(sheet!.getCell("J5").value).toBe("Brouillon");
    expect(sheet!.getCell("K5").value).toBe("");

    expect(sheet!.getCell("J6").value).toBe("Validé");
    expect(sheet!.getCell("K6").value).toBe("30/04/2026");

    expect(sheet!.getCell("A7").value).toBe("Total (2)");
    expect(sheet!.getCell("I7").value).toBe(479400);
  });

  it("rend une feuille vide lisible quand aucun bulletin n'est exporté", async () => {
    const bytes = await buildPayrollPayslipsExport([], null);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    const sheet = workbook.getWorksheet("Bulletins");
    expect(sheet!.getCell("A1").value).toBe("Bulletins de paie");
    expect(sheet!.getCell("A5").value).toBe("Aucun bulletin sur ce périmètre.");
  });
});

/* ------------------------------------------------------------------------- PAY-009 */

async function journalEntryCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId));
  return rows.length;
}

describe("PAY-009 — comptabilisation des bulletins", () => {
  it("comptabilise un bulletin validé dans le journal de paie et ne le double pas", async () => {
    const compta = await seedHrTenant(db, "payroll-compta");
    await enablePayrollAccounting(db, { tenantId: compta.tenantId, userId: compta.userId });
    await savePayrollSettings(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      raw: { paymentDayOfMonth: "28", socialEmployeeRate: "5.5", socialEmployerRate: "16" },
    });
    await createPayrollComponent(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      raw: {
        code: "PRIME",
        label: "Prime",
        kind: "earning",
        mode: "fixed",
        amountXof: "50000",
        ratePercent: "",
        taxable: true,
      },
    });

    const employee = await createEmployee(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      raw: { code: "SAL900", lastName: "Fall", firstName: "Awa", hireDate: "2024-01-01" },
    });
    const contract = await createContract(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      raw: { employeeId: employee.id, kind: "cdi", startDate: "2024-01-01", salaryXof: "200000" },
    });
    await startContract(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      contractId: contract.id,
    });

    const period = await createPayrollPeriod(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      raw: { year: "2026", month: "3" },
    });
    await generatePayrollPayslips(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      periodId: period.id,
    });
    const [payslip] = await listPayrollPayslips(db, compta.tenantId, { periodId: period.id });
    expect(payslip).toBeDefined();
    expect(await journalEntryCount(compta.tenantId)).toBe(0);

    const first = await validatePayrollPayslip(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      payslipId: payslip!.id,
    });
    expect(first.changed).toBe(true);

    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.tenantId, compta.tenantId));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.source).toBe("payroll");
    expect(entry.sourceId).toBe(payslip!.id);
    expect(entry.entryDate).toBe("2026-03-31");
    expect(entry.status).toBe("validated");
    expect(entry.totalDebit).toBe(290000);
    expect(entry.totalCredit).toBe(290000);

    const lines = await db
      .select({
        code: ledgerAccounts.code,
        debit: journalEntryLines.debit,
        credit: journalEntryLines.credit,
      })
      .from(journalEntryLines)
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
          eq(ledgerAccounts.id, journalEntryLines.accountId),
        ),
      )
      .where(eq(journalEntryLines.entryId, entry.id))
      .orderBy(asc(journalEntryLines.lineNumber));
    expect(lines).toEqual([
      { code: "661000", debit: 250000, credit: 0 },
      { code: "664000", debit: 40000, credit: 0 },
      { code: "431000", debit: 0, credit: 53750 },
      { code: "422000", debit: 0, credit: 236250 },
    ]);

    const second = await validatePayrollPayslip(db, {
      tenantId: compta.tenantId,
      actorUserId: compta.userId,
      payslipId: payslip!.id,
    });
    expect(second.changed).toBe(false);
    expect(await journalEntryCount(compta.tenantId)).toBe(1);
  });

  it("ne comptabilise rien tant que la paie n'est pas paramétrée en comptabilité", async () => {
    const period = await createPayrollPeriod(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      raw: { year: "2026", month: "8" },
    });
    await generatePayrollPayslips(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      periodId: period.id,
    });
    const [payslip] = await listPayrollPayslips(db, tenant.tenantId, { periodId: period.id });
    expect(payslip).toBeDefined();

    const result = await validatePayrollPayslip(db, {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      payslipId: payslip!.id,
    });
    expect(result.changed).toBe(true);
    expect(await journalEntryCount(tenant.tenantId)).toBe(0);
  });
});
