import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { createContract, createEmployee, startContract } from "@/modules/hr/queries";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedHrTenant, type HrTenant } from "@/test/hr";
import {
  createPayrollComponent,
  listPayrollComponents,
  setPayrollComponentActive,
  updatePayrollComponent,
} from "./components";
import { PayrollError } from "./errors";
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
    expect(overview).toEqual({ runningContracts: 1, activeComponents: 1 });
    expect(await getPayrollOverview(db, otherTenantId)).toEqual({
      runningContracts: 0,
      activeComponents: 0,
    });
  });
});
