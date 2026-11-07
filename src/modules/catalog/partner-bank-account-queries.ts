import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, partnerBankAccounts, partners } from "@/db/schema";
import type { PartnerBankAccountData } from "./partner-bank-account";
import { CatalogError } from "./errors";

export type PartnerBankAccountRecord = PartnerBankAccountData & { readonly id: string };

export async function getPartnerBankAccount(
  db: Database,
  input: { tenantId: string; partnerId: string },
): Promise<PartnerBankAccountRecord | null> {
  const [row] = await db
    .select({
      id: partnerBankAccounts.id,
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
        eq(partnerBankAccounts.partnerId, input.partnerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function masked(value: string | null): string | null {
  return value ? `••••${value.slice(-4)}` : null;
}

/** ART-024 — coordonnées de paiement accessibles au tenant, écrites atomiquement et auditées sans secret complet. */
export async function savePartnerBankAccount(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    partnerId: string;
    data: PartnerBankAccountData;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [partner] = await tx
      .select({ id: partners.id, isSupplier: partners.isSupplier })
      .from(partners)
      .where(and(eq(partners.tenantId, input.tenantId), eq(partners.id, input.partnerId)))
      .for("update")
      .limit(1);
    if (!partner || !partner.isSupplier)
      throw new CatalogError("Fournisseur introuvable dans cet espace.");

    const [before] = await tx
      .select()
      .from(partnerBankAccounts)
      .where(
        and(
          eq(partnerBankAccounts.tenantId, input.tenantId),
          eq(partnerBankAccounts.partnerId, partner.id),
        ),
      )
      .for("update")
      .limit(1);

    const values = {
      tenantId: input.tenantId,
      partnerId: partner.id,
      ...input.data,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    };
    let accountId: string;
    if (before) {
      accountId = before.id;
      await tx.update(partnerBankAccounts).set(values).where(eq(partnerBankAccounts.id, before.id));
    } else {
      const [created] = await tx
        .insert(partnerBankAccounts)
        .values(values)
        .returning({ id: partnerBankAccounts.id });
      if (!created) throw new CatalogError("Le compte bancaire fournisseur n'a pas été créé.");
      accountId = created.id;
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "catalog.partner.bank_account.update",
      entityType: "partner_bank_account",
      entityId: accountId,
      details: {
        partnerId: partner.id,
        before: auditView(before),
        after: auditView(input.data),
      },
    });
  });
}

function auditView(
  row: PartnerBankAccountData | typeof partnerBankAccounts.$inferSelect | undefined,
) {
  if (!row) return null;
  return {
    bankName: row.bankName,
    bankCountryCode: row.bankCountryCode,
    accountHolder: row.accountHolder,
    bankCode: row.bankCode,
    branchCode: row.branchCode,
    accountNumber: masked(row.accountNumber),
    ribKey: row.ribKey ? "••" : null,
    iban: masked(row.iban),
    bic: row.bic,
  };
}
