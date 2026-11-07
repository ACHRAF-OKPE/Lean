import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { partnerBankAccounts, partners } from "@/db/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface SupplierBankSnapshot {
  readonly bankName: string | null;
  readonly bankCountryCode: string | null;
  readonly accountHolder: string | null;
  readonly bankCode: string | null;
  readonly branchCode: string | null;
  readonly accountNumber: string | null;
  readonly ribKey: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
}

export interface SupplierPaymentSnapshot {
  readonly paymentTermDays: number;
  readonly bankDetails: SupplierBankSnapshot | null;
}

/** PUR-008 — fige les conditions et coordonnées du fournisseur à la génération de la commande. */
export async function loadSupplierPaymentSnapshot(
  tx: Transaction,
  input: { tenantId: string; supplierId: string },
): Promise<SupplierPaymentSnapshot | null> {
  const [supplier] = await tx
    .select({ paymentTermDays: partners.paymentTermDays })
    .from(partners)
    .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, input.supplierId)))
    .for("share")
    .limit(1);
  if (!supplier) return null;

  const [bank] = await tx
    .select({
      bankName: partnerBankAccounts.bankName,
      bankCountryCode: partnerBankAccounts.bankCountryCode,
      accountHolder: partnerBankAccounts.accountHolder,
      bankCode: partnerBankAccounts.bankCode,
      branchCode: partnerBankAccounts.branchCode,
      accountNumber: partnerBankAccounts.accountNumber,
      ribKey: partnerBankAccounts.ribKey,
      iban: partnerBankAccounts.iban,
      bic: partnerBankAccounts.bic,
    })
    .from(partnerBankAccounts)
    .where(
      and(
        eq(partnerBankAccounts.tenantId, input.tenantId),
        eq(partnerBankAccounts.partnerId, input.supplierId),
      ),
    )
    .for("share")
    .limit(1);

  return { paymentTermDays: supplier.paymentTermDays, bankDetails: bank ?? null };
}
