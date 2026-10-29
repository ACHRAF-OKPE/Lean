"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { AccountingError } from "@/modules/accounting/errors";
import { letterLines, unletterGroup } from "@/modules/accounting/lettering";
import { postCutoffDocuments } from "@/modules/accounting/posting";
import { saveAccountingSettings } from "@/modules/accounting/settings";
import {
  closeFiscalYear,
  createAccount,
  createFiscalYear,
  createJournal,
  createJournalEntry,
  deleteJournalEntry,
  setAccountActive,
  setJournalActive,
  validateJournalEntry,
} from "@/modules/accounting/queries";
import type { AccountingFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function values(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

function failure(error: unknown): AccountingFormState {
  if (error instanceof AccountingError) {
    return { errors: [error.message] };
  }
  throw error;
}

export async function createFiscalYearAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  try {
    await createFiscalYear(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        label: text(formData, "label"),
        startsOn: text(formData, "startsOn"),
        endsOn: text(formData, "endsOn"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/exercices?cree=1");
}

export async function closeFiscalYearAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const fiscalYearId = text(formData, "fiscalYearId");
  if (!UUID_PATTERN.test(fiscalYearId)) {
    return { errors: ["Exercice invalide."] };
  }
  try {
    await closeFiscalYear(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      fiscalYearId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/exercices?clos=1");
}

export async function createAccountAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  try {
    await createAccount(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        label: text(formData, "label"),
        active: formData.get("active") !== null,
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/comptes?cree=1");
}

export async function toggleAccountAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const accountId = text(formData, "accountId");
  if (!UUID_PATTERN.test(accountId)) {
    return { errors: ["Compte invalide."] };
  }
  try {
    await setAccountActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      accountId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/comptes?maj=1");
}

export async function createJournalAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  try {
    await createJournal(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        label: text(formData, "label"),
        type: text(formData, "type"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/journaux?cree=1");
}

export async function toggleJournalAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const journalId = text(formData, "journalId");
  if (!UUID_PATTERN.test(journalId)) {
    return { errors: ["Journal invalide."] };
  }
  try {
    await setJournalActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      journalId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/journaux?maj=1");
}

export async function createEntryAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const accountIds = values(formData, "compte");
  const partnerIds = values(formData, "tiers");
  const lineLabels = values(formData, "libelle_ligne");
  const debits = values(formData, "debit");
  const credits = values(formData, "credit");
  const lines = accountIds.map((accountId, index) => ({
    accountId,
    partnerId: partnerIds[index] ?? "",
    label: lineLabels[index] ?? "",
    debit: debits[index] ?? "",
    credit: credits[index] ?? "",
  }));

  let entryId: string;
  try {
    const created = await createJournalEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        journalId: text(formData, "journalId"),
        entryDate: text(formData, "entryDate"),
        reference: text(formData, "reference"),
        label: text(formData, "label"),
        lines,
      },
    });
    entryId = created.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/comptabilite/ecritures/${entryId}?cree=1`);
}

export async function validateEntryAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const entryId = text(formData, "entryId");
  if (!UUID_PATTERN.test(entryId)) {
    return { errors: ["Écriture invalide."] };
  }
  try {
    await validateJournalEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entryId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/comptabilite/ecritures/${entryId}?valide=1`);
}

export async function deleteEntryAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const entryId = text(formData, "entryId");
  if (!UUID_PATTERN.test(entryId)) {
    return { errors: ["Écriture invalide."] };
  }
  try {
    await deleteJournalEntry(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      entryId,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/ecritures?supprime=1");
}

export async function saveAccountingSettingsAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  try {
    await saveAccountingSettings(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        salesJournalId: text(formData, "salesJournalId"),
        purchaseJournalId: text(formData, "purchaseJournalId"),
        bankJournalId: text(formData, "bankJournalId"),
        customerAccountId: text(formData, "customerAccountId"),
        supplierAccountId: text(formData, "supplierAccountId"),
        salesAccountId: text(formData, "salesAccountId"),
        purchaseAccountId: text(formData, "purchaseAccountId"),
        bankAccountId: text(formData, "bankAccountId"),
      },
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/parametres?enregistre=1");
}

export async function letterLinesAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const lineIds = values(formData, "ligne");
  if (lineIds.length < 2) {
    return { errors: ["Sélectionnez au moins deux lignes de tiers."] };
  }
  try {
    await letterLines(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      lineIds,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/lettrage?lettre=1");
}

export async function unletterGroupAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  try {
    await unletterGroup(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      code: text(formData, "code"),
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/comptabilite/lettrage?delettre=1");
}

export async function postCutoffAction(
  _state: AccountingFormState,
  formData: FormData,
): Promise<AccountingFormState> {
  const session = await requirePermission("data.write");
  const fiscalYearId = text(formData, "fiscalYearId");
  if (!UUID_PATTERN.test(fiscalYearId)) {
    return { errors: ["Exercice invalide."] };
  }
  let posted = 0;
  try {
    const result = await postCutoffDocuments(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      fiscalYearId,
    });
    posted = result.posted;
  } catch (error) {
    return failure(error);
  }
  redirect(`/comptabilite/rapprochement?exercice=${fiscalYearId}&comptabilise=${posted}`);
}
