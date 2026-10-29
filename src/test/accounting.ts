import type { Database } from "@/db/client";
import {
  accountingJournals,
  fiscalYears,
  ledgerAccounts,
  partners,
  tenants,
  users,
} from "@/db/schema";
import { saveAccountingSettings } from "@/modules/accounting/settings";

let tenantCounter = 0;

export interface AccountingTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly fiscalYear2026Id: string;
  readonly fiscalYear2027Id: string;
  readonly closedFiscalYearId: string;
  readonly clientAccountId: string;
  readonly supplierAccountId: string;
  readonly bankAccountId: string;
  readonly inactiveAccountId: string;
  readonly purchaseAccountId: string;
  readonly salesAccountId: string;
  readonly saleJournalId: string;
  readonly purchaseJournalId: string;
  readonly bankJournalId: string;
  readonly inactiveJournalId: string;
  readonly partnerId: string;
}

export async function seedAccountingTenant(
  db: Database,
  label = "compta",
): Promise<AccountingTenant> {
  tenantCounter += 1;

  const [tenant] = await db
    .insert(tenants)
    .values({ slug: `test-compta-${tenantCounter}-${label}`, name: `Espace ${label}` })
    .returning({ id: tenants.id });
  const [user] = await db
    .insert(users)
    .values({
      email: `compta-${tenantCounter}@test.local`,
      name: "Awa Test",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });

  if (!tenant || !user) {
    throw new Error("Tenant de test non créé.");
  }

  const yearRows = await db
    .insert(fiscalYears)
    .values([
      {
        tenantId: tenant.id,
        label: "Exercice 2026",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        status: "open" as const,
      },
      {
        tenantId: tenant.id,
        label: "Exercice 2027",
        startsOn: "2027-01-01",
        endsOn: "2027-12-31",
        status: "open" as const,
      },
      {
        tenantId: tenant.id,
        label: "Exercice 2025",
        startsOn: "2025-01-01",
        endsOn: "2025-12-31",
        status: "closed" as const,
        closedAt: new Date("2026-01-10T08:00:00Z"),
        closedByUserId: user.id,
      },
    ])
    .returning({ id: fiscalYears.id, label: fiscalYears.label });
  const year2026 = yearRows.find((row) => row.label === "Exercice 2026");
  const year2027 = yearRows.find((row) => row.label === "Exercice 2027");
  const year2025 = yearRows.find((row) => row.label === "Exercice 2025");
  if (!year2026 || !year2027 || !year2025) {
    throw new Error("Exercices de test non créés.");
  }

  const accountRows = await db
    .insert(ledgerAccounts)
    .values([
      { tenantId: tenant.id, code: "411000", label: "Clients", accountClass: 4 },
      { tenantId: tenant.id, code: "401000", label: "Fournisseurs", accountClass: 4 },
      { tenantId: tenant.id, code: "521000", label: "Banque", accountClass: 5 },
      {
        tenantId: tenant.id,
        code: "571000",
        label: "Caisse",
        accountClass: 5,
        active: false,
      },
      { tenantId: tenant.id, code: "601000", label: "Achats de marchandises", accountClass: 6 },
      { tenantId: tenant.id, code: "701000", label: "Ventes de marchandises", accountClass: 7 },
    ])
    .returning({ id: ledgerAccounts.id, code: ledgerAccounts.code });
  const accountByCode = new Map(accountRows.map((row) => [row.code, row.id]));

  const journalRows = await db
    .insert(accountingJournals)
    .values([
      { tenantId: tenant.id, code: "VE", label: "Journal des ventes", type: "sale" as const },
      { tenantId: tenant.id, code: "AC", label: "Journal des achats", type: "purchase" as const },
      { tenantId: tenant.id, code: "BQ", label: "Journal de banque", type: "bank" as const },
      {
        tenantId: tenant.id,
        code: "OD",
        label: "Opérations diverses",
        type: "misc" as const,
        active: false,
      },
    ])
    .returning({ id: accountingJournals.id, code: accountingJournals.code });
  const journalByCode = new Map(journalRows.map((row) => [row.code, row.id]));

  const [partner] = await db
    .insert(partners)
    .values({
      tenantId: tenant.id,
      code: "CLI001",
      name: "Sahel Distribution",
      type: "company",
      isCustomer: true,
      isSupplier: false,
    })
    .returning({ id: partners.id });

  const required = {
    client: accountByCode.get("411000"),
    supplier: accountByCode.get("401000"),
    bank: accountByCode.get("521000"),
    inactiveAccount: accountByCode.get("571000"),
    purchase: accountByCode.get("601000"),
    sales: accountByCode.get("701000"),
    sale: journalByCode.get("VE"),
    purchaseJournal: journalByCode.get("AC"),
    bankJournal: journalByCode.get("BQ"),
    inactiveJournal: journalByCode.get("OD"),
  };
  if (Object.values(required).some((value) => value === undefined) || !partner) {
    throw new Error("Référentiels comptables de test non créés.");
  }

  return {
    tenantId: tenant.id,
    userId: user.id,
    fiscalYear2026Id: year2026.id,
    fiscalYear2027Id: year2027.id,
    closedFiscalYearId: year2025.id,
    clientAccountId: required.client!,
    supplierAccountId: required.supplier!,
    bankAccountId: required.bank!,
    inactiveAccountId: required.inactiveAccount!,
    purchaseAccountId: required.purchase!,
    salesAccountId: required.sales!,
    saleJournalId: required.sale!,
    purchaseJournalId: required.purchaseJournal!,
    bankJournalId: required.bankJournal!,
    inactiveJournalId: required.inactiveJournal!,
    partnerId: partner.id,
  };
}

export interface AccountingRefs {
  readonly fiscalYear2026Id: string;
  readonly clientAccountId: string;
  readonly supplierAccountId: string;
  readonly bankAccountId: string;
  readonly purchaseAccountId: string;
  readonly salesAccountId: string;
  readonly saleJournalId: string;
  readonly purchaseJournalId: string;
  readonly bankJournalId: string;
}

export async function enableAccounting(
  db: Database,
  input: { readonly tenantId: string; readonly userId: string },
): Promise<AccountingRefs> {
  const [year] = await db
    .insert(fiscalYears)
    .values({
      tenantId: input.tenantId,
      label: "Exercice 2026",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      status: "open" as const,
    })
    .returning({ id: fiscalYears.id });

  const accountRows = await db
    .insert(ledgerAccounts)
    .values([
      { tenantId: input.tenantId, code: "411000", label: "Clients", accountClass: 4 },
      { tenantId: input.tenantId, code: "401000", label: "Fournisseurs", accountClass: 4 },
      { tenantId: input.tenantId, code: "521000", label: "Banque", accountClass: 5 },
      { tenantId: input.tenantId, code: "601000", label: "Achats", accountClass: 6 },
      { tenantId: input.tenantId, code: "701000", label: "Ventes", accountClass: 7 },
    ])
    .returning({ id: ledgerAccounts.id, code: ledgerAccounts.code });
  const accountByCode = new Map(accountRows.map((row) => [row.code, row.id]));

  const journalRows = await db
    .insert(accountingJournals)
    .values([
      { tenantId: input.tenantId, code: "VE", label: "Journal des ventes", type: "sale" as const },
      {
        tenantId: input.tenantId,
        code: "AC",
        label: "Journal des achats",
        type: "purchase" as const,
      },
      { tenantId: input.tenantId, code: "BQ", label: "Journal de banque", type: "bank" as const },
    ])
    .returning({ id: accountingJournals.id, code: accountingJournals.code });
  const journalByCode = new Map(journalRows.map((row) => [row.code, row.id]));

  const clientAccountId = accountByCode.get("411000");
  const supplierAccountId = accountByCode.get("401000");
  const bankAccountId = accountByCode.get("521000");
  const purchaseAccountId = accountByCode.get("601000");
  const salesAccountId = accountByCode.get("701000");
  const saleJournalId = journalByCode.get("VE");
  const purchaseJournalId = journalByCode.get("AC");
  const bankJournalId = journalByCode.get("BQ");
  if (
    !year ||
    !clientAccountId ||
    !supplierAccountId ||
    !bankAccountId ||
    !purchaseAccountId ||
    !salesAccountId ||
    !saleJournalId ||
    !purchaseJournalId ||
    !bankJournalId
  ) {
    throw new Error("Référentiel comptable de test non créé.");
  }

  await saveAccountingSettings(db, {
    tenantId: input.tenantId,
    actorUserId: input.userId,
    raw: {
      salesJournalId: saleJournalId,
      purchaseJournalId,
      bankJournalId,
      customerAccountId: clientAccountId,
      supplierAccountId,
      salesAccountId,
      purchaseAccountId,
      bankAccountId,
    },
  });

  return {
    fiscalYear2026Id: year.id,
    clientAccountId,
    supplierAccountId,
    bankAccountId,
    purchaseAccountId,
    salesAccountId,
    saleJournalId,
    purchaseJournalId,
    bankJournalId,
  };
}
