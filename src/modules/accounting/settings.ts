import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { accountingJournals, accountingSettings, auditEvents, ledgerAccounts } from "@/db/schema";
import type { AccountingJournalType } from "@/db/schema";
import { AccountingError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountingSettingsRecord {
  readonly id: string;
  readonly salesJournalId: string;
  readonly purchaseJournalId: string;
  readonly bankJournalId: string;
  readonly customerAccountId: string;
  readonly supplierAccountId: string;
  readonly salesAccountId: string;
  readonly purchaseAccountId: string;
  readonly bankAccountId: string;
  readonly payrollJournalId: string | null;
  readonly payrollExpenseAccountId: string | null;
  readonly payrollEmployerChargeAccountId: string | null;
  readonly payrollSocialAccountId: string | null;
  readonly payrollDeductionAccountId: string | null;
  readonly payrollPayableAccountId: string | null;
}

export interface AccountingSettingsView extends AccountingSettingsRecord {
  readonly salesJournalCode: string;
  readonly purchaseJournalCode: string;
  readonly bankJournalCode: string;
  readonly customerAccountCode: string;
  readonly supplierAccountCode: string;
  readonly salesAccountCode: string;
  readonly purchaseAccountCode: string;
  readonly bankAccountCode: string;
  readonly payrollJournalCode: string | null;
  readonly payrollExpenseAccountCode: string | null;
  readonly payrollEmployerChargeAccountCode: string | null;
  readonly payrollSocialAccountCode: string | null;
  readonly payrollDeductionAccountCode: string | null;
  readonly payrollPayableAccountCode: string | null;
  readonly updatedAt: Date;
}

export async function loadAccountingSettings(
  db: Database | Transaction,
  tenantId: string,
): Promise<AccountingSettingsRecord | null> {
  const [row] = await db
    .select({
      id: accountingSettings.id,
      salesJournalId: accountingSettings.salesJournalId,
      purchaseJournalId: accountingSettings.purchaseJournalId,
      bankJournalId: accountingSettings.bankJournalId,
      customerAccountId: accountingSettings.customerAccountId,
      supplierAccountId: accountingSettings.supplierAccountId,
      salesAccountId: accountingSettings.salesAccountId,
      purchaseAccountId: accountingSettings.purchaseAccountId,
      bankAccountId: accountingSettings.bankAccountId,
      payrollJournalId: accountingSettings.payrollJournalId,
      payrollExpenseAccountId: accountingSettings.payrollExpenseAccountId,
      payrollEmployerChargeAccountId: accountingSettings.payrollEmployerChargeAccountId,
      payrollSocialAccountId: accountingSettings.payrollSocialAccountId,
      payrollDeductionAccountId: accountingSettings.payrollDeductionAccountId,
      payrollPayableAccountId: accountingSettings.payrollPayableAccountId,
    })
    .from(accountingSettings)
    .where(eq(accountingSettings.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function getAccountingSettingsView(
  db: Database,
  tenantId: string,
): Promise<AccountingSettingsView | null> {
  const [row] = await db
    .select()
    .from(accountingSettings)
    .where(eq(accountingSettings.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return null;
  }

  const journalIds = [
    row.salesJournalId,
    row.purchaseJournalId,
    row.bankJournalId,
    row.payrollJournalId,
  ].filter((id): id is string => id !== null);
  const accountIds = [
    row.customerAccountId,
    row.supplierAccountId,
    row.salesAccountId,
    row.purchaseAccountId,
    row.bankAccountId,
    row.payrollExpenseAccountId,
    row.payrollEmployerChargeAccountId,
    row.payrollSocialAccountId,
    row.payrollDeductionAccountId,
    row.payrollPayableAccountId,
  ].filter((id): id is string => id !== null);
  const [journalRows, accountRows] = await Promise.all([
    db
      .select({ id: accountingJournals.id, code: accountingJournals.code })
      .from(accountingJournals)
      .where(
        and(eq(accountingJournals.tenantId, tenantId), inArray(accountingJournals.id, journalIds)),
      ),
    db
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, tenantId), inArray(ledgerAccounts.id, accountIds))),
  ]);
  const journalCode = new Map(journalRows.map((journal) => [journal.id, journal.code]));
  const accountCode = new Map(accountRows.map((account) => [account.id, account.code]));

  return {
    ...row,
    salesJournalCode: journalCode.get(row.salesJournalId) ?? "—",
    purchaseJournalCode: journalCode.get(row.purchaseJournalId) ?? "—",
    bankJournalCode: journalCode.get(row.bankJournalId) ?? "—",
    customerAccountCode: accountCode.get(row.customerAccountId) ?? "—",
    supplierAccountCode: accountCode.get(row.supplierAccountId) ?? "—",
    salesAccountCode: accountCode.get(row.salesAccountId) ?? "—",
    purchaseAccountCode: accountCode.get(row.purchaseAccountId) ?? "—",
    bankAccountCode: accountCode.get(row.bankAccountId) ?? "—",
    payrollJournalCode: row.payrollJournalId
      ? (journalCode.get(row.payrollJournalId) ?? null)
      : null,
    payrollExpenseAccountCode: row.payrollExpenseAccountId
      ? (accountCode.get(row.payrollExpenseAccountId) ?? null)
      : null,
    payrollEmployerChargeAccountCode: row.payrollEmployerChargeAccountId
      ? (accountCode.get(row.payrollEmployerChargeAccountId) ?? null)
      : null,
    payrollSocialAccountCode: row.payrollSocialAccountId
      ? (accountCode.get(row.payrollSocialAccountId) ?? null)
      : null,
    payrollDeductionAccountCode: row.payrollDeductionAccountId
      ? (accountCode.get(row.payrollDeductionAccountId) ?? null)
      : null,
    payrollPayableAccountCode: row.payrollPayableAccountId
      ? (accountCode.get(row.payrollPayableAccountId) ?? null)
      : null,
  };
}

export interface SaveAccountingSettingsInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly salesJournalId: unknown;
    readonly purchaseJournalId: unknown;
    readonly bankJournalId: unknown;
    readonly customerAccountId: unknown;
    readonly supplierAccountId: unknown;
    readonly salesAccountId: unknown;
    readonly purchaseAccountId: unknown;
    readonly bankAccountId: unknown;
    readonly payrollJournalId?: unknown;
    readonly payrollExpenseAccountId?: unknown;
    readonly payrollEmployerChargeAccountId?: unknown;
    readonly payrollSocialAccountId?: unknown;
    readonly payrollDeductionAccountId?: unknown;
    readonly payrollPayableAccountId?: unknown;
  };
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function uuidOf(raw: unknown, label: string): string {
  const value = textOf(raw);
  if (!value) {
    throw new AccountingError(`${label} : obligatoire.`);
  }
  if (!UUID_PATTERN.test(value)) {
    throw new AccountingError(`${label} : référence invalide.`);
  }
  return value;
}

function optionalUuidOf(raw: unknown, label: string): string | null {
  const value = textOf(raw);
  if (!value) {
    return null;
  }
  if (!UUID_PATTERN.test(value)) {
    throw new AccountingError(`${label} : référence invalide.`);
  }
  return value;
}

interface JournalRef {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
  readonly type: AccountingJournalType;
}

interface AccountRef {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
  readonly accountClass: number;
}

export async function saveAccountingSettings(
  db: Database,
  input: SaveAccountingSettingsInput,
): Promise<{ created: boolean }> {
  const journalIds = {
    sales: uuidOf(input.raw.salesJournalId, "Journal des ventes"),
    purchase: uuidOf(input.raw.purchaseJournalId, "Journal des achats"),
    bank: uuidOf(input.raw.bankJournalId, "Journal de banque"),
  };
  const accountIds = {
    customer: uuidOf(input.raw.customerAccountId, "Compte client"),
    supplier: uuidOf(input.raw.supplierAccountId, "Compte fournisseur"),
    sales: uuidOf(input.raw.salesAccountId, "Compte de vente"),
    purchase: uuidOf(input.raw.purchaseAccountId, "Compte d'achat"),
    bank: uuidOf(input.raw.bankAccountId, "Compte de banque"),
  };
  const payroll = {
    journal: optionalUuidOf(input.raw.payrollJournalId, "Journal de paie"),
    expense: optionalUuidOf(input.raw.payrollExpenseAccountId, "Compte de charges de personnel"),
    employerCharge: optionalUuidOf(
      input.raw.payrollEmployerChargeAccountId,
      "Compte de charges sociales patronales",
    ),
    social: optionalUuidOf(input.raw.payrollSocialAccountId, "Compte d'organismes sociaux"),
    deduction: optionalUuidOf(input.raw.payrollDeductionAccountId, "Compte de retenues diverses"),
    payable: optionalUuidOf(
      input.raw.payrollPayableAccountId,
      "Compte de rémunérations dues au personnel",
    ),
  };
  const payrollValues = Object.values(payroll);
  const payrollFilled = payrollValues.filter((value) => value !== null).length;
  if (payrollFilled > 0 && payrollFilled < payrollValues.length) {
    throw new AccountingError(
      "Comptabilisation de la paie : renseignez le journal et les cinq comptes, ou laissez tout vide.",
    );
  }
  const payrollAccountIds = [
    payroll.expense,
    payroll.employerCharge,
    payroll.social,
    payroll.deduction,
    payroll.payable,
  ].filter((id): id is string => id !== null);

  return db.transaction(async (tx) => {
    const journalRows = await tx
      .select({
        id: accountingJournals.id,
        code: accountingJournals.code,
        active: accountingJournals.active,
        type: accountingJournals.type,
      })
      .from(accountingJournals)
      .where(
        and(
          eq(accountingJournals.tenantId, input.tenantId),
          inArray(accountingJournals.id, [
            ...Object.values(journalIds),
            ...(payroll.journal ? [payroll.journal] : []),
          ]),
        ),
      );
    const journals = new Map(journalRows.map((row) => [row.id, row]));

    const accountRows = await tx
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        active: ledgerAccounts.active,
        accountClass: ledgerAccounts.accountClass,
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.tenantId, input.tenantId),
          inArray(ledgerAccounts.id, [...Object.values(accountIds), ...payrollAccountIds]),
        ),
      );
    const accounts = new Map(accountRows.map((row) => [row.id, row]));

    function journal(
      label: string,
      id: string,
      type: AccountingJournalType,
      typeLabel: string,
    ): JournalRef {
      const journal = journals.get(id);
      if (!journal) {
        throw new AccountingError(`${label} : journal introuvable dans cet espace.`);
      }
      if (!journal.active) {
        throw new AccountingError(`${label} : le journal ${journal.code} est inactif.`);
      }
      if (journal.type !== type) {
        throw new AccountingError(
          `${label} : le journal ${journal.code} doit être de type ${typeLabel}.`,
        );
      }
      return journal;
    }

    function account(label: string, id: string, accountClass: number): AccountRef {
      const account = accounts.get(id);
      if (!account) {
        throw new AccountingError(`${label} : compte introuvable dans cet espace.`);
      }
      if (!account.active) {
        throw new AccountingError(`${label} : le compte ${account.code} est inactif.`);
      }
      if (account.accountClass !== accountClass) {
        throw new AccountingError(
          `${label} : le compte ${account.code} doit appartenir à la classe ${accountClass}.`,
        );
      }
      return account;
    }

    const salesJournal = journal("Journal des ventes", journalIds.sales, "sale", "vente");
    const purchaseJournal = journal("Journal des achats", journalIds.purchase, "purchase", "achat");
    const bankJournal = journal("Journal de banque", journalIds.bank, "bank", "banque");
    const customerAccount = account("Compte client", accountIds.customer, 4);
    const supplierAccount = account("Compte fournisseur", accountIds.supplier, 4);
    const salesAccount = account("Compte de vente", accountIds.sales, 7);
    const purchaseAccount = account("Compte d'achat", accountIds.purchase, 6);
    const bankAccount = account("Compte de banque", accountIds.bank, 5);

    const payrollJournal = payroll.journal
      ? journal("Journal de paie", payroll.journal, "misc", "divers")
      : null;
    const payrollExpenseAccount = payroll.expense
      ? account("Compte de charges de personnel", payroll.expense, 6)
      : null;
    const payrollEmployerChargeAccount = payroll.employerCharge
      ? account("Compte de charges sociales patronales", payroll.employerCharge, 6)
      : null;
    const payrollSocialAccount = payroll.social
      ? account("Compte d'organismes sociaux", payroll.social, 4)
      : null;
    const payrollDeductionAccount = payroll.deduction
      ? account("Compte de retenues diverses", payroll.deduction, 4)
      : null;
    const payrollPayableAccount = payroll.payable
      ? account("Compte de rémunérations dues au personnel", payroll.payable, 4)
      : null;

    const [existing] = await tx
      .select({ id: accountingSettings.id })
      .from(accountingSettings)
      .where(eq(accountingSettings.tenantId, input.tenantId))
      .limit(1)
      .for("update");

    const values = {
      tenantId: input.tenantId,
      salesJournalId: salesJournal.id,
      purchaseJournalId: purchaseJournal.id,
      bankJournalId: bankJournal.id,
      customerAccountId: customerAccount.id,
      supplierAccountId: supplierAccount.id,
      salesAccountId: salesAccount.id,
      purchaseAccountId: purchaseAccount.id,
      bankAccountId: bankAccount.id,
      payrollJournalId: payrollJournal?.id ?? null,
      payrollExpenseAccountId: payrollExpenseAccount?.id ?? null,
      payrollEmployerChargeAccountId: payrollEmployerChargeAccount?.id ?? null,
      payrollSocialAccountId: payrollSocialAccount?.id ?? null,
      payrollDeductionAccountId: payrollDeductionAccount?.id ?? null,
      payrollPayableAccountId: payrollPayableAccount?.id ?? null,
      updatedByUserId: input.actorUserId,
    };

    await tx
      .insert(accountingSettings)
      .values(values)
      .onConflictDoUpdate({
        target: accountingSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "accounting.settings.update",
      entityType: "accounting_settings",
      entityId: input.tenantId,
      details: {
        created: !existing,
        journals: {
          sales: salesJournal.code,
          purchase: purchaseJournal.code,
          bank: bankJournal.code,
        },
        accounts: {
          customer: customerAccount.code,
          supplier: supplierAccount.code,
          sales: salesAccount.code,
          purchase: purchaseAccount.code,
          bank: bankAccount.code,
        },
        payroll:
          payrollJournal === null
            ? null
            : {
                journal: payrollJournal.code,
                expense: payrollExpenseAccount?.code ?? null,
                employerCharge: payrollEmployerChargeAccount?.code ?? null,
                social: payrollSocialAccount?.code ?? null,
                deduction: payrollDeductionAccount?.code ?? null,
                payable: payrollPayableAccount?.code ?? null,
              },
      },
    });

    return { created: !existing };
  });
}
