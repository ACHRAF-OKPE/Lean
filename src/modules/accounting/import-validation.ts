import type {
  RawImportRow,
  ValidationContext,
  ValidationResult,
  ValidatedRow,
} from "@/modules/catalog/validation";
import { parseIsoDate, parseXofPrice } from "@/modules/shared/validation";
import { validateAccountInput } from "./validation";

export interface AccountingAccountReference {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
}

export interface AccountingJournalReference {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
}

export interface AccountingPartnerReference {
  readonly id: string;
  readonly code: string;
}

export interface AccountingFiscalYearRange {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface AccountImportData {
  code: string;
  label: string;
  active: boolean;
}

export interface JournalEntryImportData {
  journalId: string;
  journalCode: string;
  entryDate: string;
  reference: string | null;
  label: string;
  lineLabel: string | null;
  accountId: string;
  accountCode: string;
  partnerId: string | null;
  partnerCode: string | null;
  debit: number;
  credit: number;
  groupKey: string;
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function importBoolean(raw: unknown): { value: boolean; errors: string[] } {
  const text = textOf(raw).toLowerCase();
  if (!text) {
    return { value: true, errors: [] };
  }
  if (["oui", "true", "1"].includes(text)) {
    return { value: true, errors: [] };
  }
  if (["non", "false", "0"].includes(text)) {
    return { value: false, errors: [] };
  }
  return { value: true, errors: ["Actif : répondez Oui ou Non."] };
}

function importAmount(
  raw: unknown,
  label: string,
): {
  value: number;
  errors: string[];
  warnings: string[];
} {
  const text = textOf(raw);
  if (!text) {
    return { value: 0, errors: [], warnings: [] };
  }
  return parseXofPrice(text, label);
}

function recomputeStatuses(rows: readonly ValidatedRow[]): void {
  for (const row of rows) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }
}

export function validateAccountImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
): ValidationResult {
  const existing = context.accountingAccountsByCode ?? new Map();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const active = importBoolean(row.values["actif"]);
    errors.push(...active.errors);

    const account = validateAccountInput({
      code: row.values["code"],
      label: row.values["libelle"],
      active: active.value,
    });
    errors.push(...account.errors);
    warnings.push(...account.warnings);

    if (account.data && existing.has(account.data.code)) {
      warnings.push("Code déjà présent : la ligne mettra à jour le compte existant.");
    }

    const data: AccountImportData = {
      code: account.data?.code ?? "",
      label: account.data?.label ?? "",
      active: account.data?.active ?? true,
    };

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: account.data?.code ?? null,
      errors,
      warnings,
      data: { ...data },
    };
  });

  const byCode = new Map<string, ValidatedRow[]>();
  for (const row of validated) {
    if (!row.code) {
      continue;
    }
    const group = byCode.get(row.code) ?? [];
    group.push(row);
    byCode.set(row.code, group);
  }
  for (const [code, group] of byCode) {
    if (group.length < 2) {
      continue;
    }
    const lines = group.map((row) => row.rowNumber).join(", ");
    for (const row of group) {
      row.errors.push(`Code ${code} : présent plusieurs fois dans le fichier (lignes ${lines}).`);
    }
  }

  recomputeStatuses(validated);

  const notes: string[] = [];
  const applicable = validated.filter((row) => row.errors.length === 0).length;
  if (applicable > 0) {
    notes.push(
      `${applicable} compte${applicable > 1 ? "s" : ""} ${applicable > 1 ? "seront" : "sera"} créé${applicable > 1 ? "s" : ""} ou mis à jour à la confirmation.`,
    );
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}

function groupKeyOf(
  journalId: string,
  entryDate: string,
  reference: string | null,
  label: string,
): string {
  return JSON.stringify([journalId, entryDate, reference ?? "", label]);
}

export function validateJournalEntryImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
): ValidationResult {
  const journals = context.accountingJournalsByCode ?? new Map();
  const accounts = context.accountingAccountsByCode ?? new Map();
  const partnerRefs = context.accountingPartnersByCode ?? new Map();
  const openYears = context.accountingOpenFiscalYears ?? [];

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const journalText = textOf(row.values["journal"]);
    const journalCode = journalText.toUpperCase();
    let journal: AccountingJournalReference | undefined;
    if (!journalCode) {
      errors.push("Journal : obligatoire.");
    } else {
      if (journalCode !== journalText) {
        warnings.push("Journal : normalisé en majuscules.");
      }
      journal = journals.get(journalCode);
      if (!journal) {
        errors.push(`Journal ${journalCode} inconnu dans cet espace.`);
      } else if (!journal.active) {
        errors.push(`Journal ${journalCode} inactif : aucune écriture ne peut y être importée.`);
      }
    }

    const date = parseIsoDate(row.values["date"], "Date de l'écriture");
    errors.push(...date.errors);
    warnings.push(...date.warnings);
    if (
      date.value &&
      !openYears.some((year) => date.value! >= year.startsOn && date.value! <= year.endsOn)
    ) {
      errors.push(`Date de l'écriture : aucun exercice ouvert ne couvre le ${date.value}.`);
    }

    const referenceText = textOf(row.values["piece"]);
    if (referenceText.length > 60) {
      errors.push("Pièce : 60 caractères maximum.");
    }
    const reference = referenceText.length > 0 && referenceText.length <= 60 ? referenceText : null;

    const entryLabelText = textOf(row.values["libelle"]);
    if (!entryLabelText) {
      errors.push("Libellé de l'écriture : obligatoire.");
    } else if (entryLabelText.length > 160) {
      errors.push("Libellé de l'écriture : 160 caractères maximum.");
    }

    const lineLabelText = textOf(row.values["libelle_ligne"]);
    if (lineLabelText.length > 120) {
      errors.push("Libellé de ligne : 120 caractères maximum.");
    }
    const lineLabel =
      lineLabelText.length > 0 && lineLabelText.length <= 120 ? lineLabelText : null;

    const accountText = textOf(row.values["compte"]);
    const accountCode = accountText.replace(/[\s\u00a0\u202f]/g, "");
    let account: AccountingAccountReference | undefined;
    if (!accountCode) {
      errors.push("Compte : obligatoire.");
    } else {
      if (typeof row.values["compte"] === "number") {
        warnings.push("Compte lu comme un nombre : vérifiez sa saisie.");
      }
      account = accounts.get(accountCode);
      if (!account) {
        errors.push(`Compte ${accountCode} inconnu : importez d'abord le plan comptable.`);
      } else if (!account.active) {
        errors.push(`Compte ${accountCode} inactif : choisissez un compte actif.`);
      }
    }

    const partnerText = textOf(row.values["tiers"]);
    const partnerCode = partnerText.toUpperCase();
    let partner: AccountingPartnerReference | undefined;
    if (partnerCode) {
      if (partnerCode !== partnerText) {
        warnings.push("Tiers : normalisé en majuscules.");
      }
      partner = partnerRefs.get(partnerCode);
      if (!partner) {
        errors.push(`Tiers ${partnerCode} inconnu dans cet espace.`);
      }
    }

    const debit = importAmount(row.values["debit"], "Débit");
    const credit = importAmount(row.values["credit"], "Crédit");
    errors.push(...debit.errors, ...credit.errors);
    warnings.push(...debit.warnings, ...credit.warnings);
    if (debit.value > 0 && credit.value > 0) {
      errors.push("Débit et crédit : un seul montant par ligne.");
    } else if (debit.value === 0 && credit.value === 0) {
      errors.push("Débit ou crédit : un montant strictement positif attendu.");
    }

    const entryDate = date.value ?? "";
    const entryLabel =
      entryLabelText.length > 0 && entryLabelText.length <= 160 ? entryLabelText : "";
    const data: JournalEntryImportData = {
      journalId: journal?.id ?? "",
      journalCode,
      entryDate,
      reference,
      label: entryLabel,
      lineLabel,
      accountId: account?.id ?? "",
      accountCode,
      partnerId: partner?.id ?? null,
      partnerCode: partnerCode || null,
      debit: debit.value,
      credit: credit.value,
      groupKey:
        journal && entryDate && entryLabel
          ? groupKeyOf(journal.id, entryDate, reference, entryLabel)
          : "",
    };

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: journalCode || null,
      errors,
      warnings,
      data: { ...data },
    };
  });

  const groups = new Map<string, { rows: ValidatedRow[]; label: string; date: string }>();
  for (const row of validated) {
    if (row.errors.length > 0) {
      continue;
    }
    const data = row.data as unknown as JournalEntryImportData;
    if (!data.groupKey) {
      continue;
    }
    const group = groups.get(data.groupKey) ?? {
      rows: [],
      label: data.label,
      date: data.entryDate,
    };
    group.rows.push(row);
    groups.set(data.groupKey, group);
  }

  for (const group of groups.values()) {
    const data = group.rows[0]?.data as unknown as JournalEntryImportData;
    const prefix = `Écriture « ${group.label} » du ${group.date} (journal ${data.journalCode})`;
    if (group.rows.length < 2) {
      for (const row of group.rows) {
        row.errors.push(`${prefix} : au moins deux lignes valides attendues.`);
      }
      continue;
    }
    let debit = 0;
    let credit = 0;
    for (const row of group.rows) {
      const line = row.data as unknown as JournalEntryImportData;
      debit += line.debit;
      credit += line.credit;
    }
    if (debit !== credit) {
      for (const row of group.rows) {
        row.errors.push(`${prefix} déséquilibrée : débit ${debit} XOF, crédit ${credit} XOF.`);
      }
    }
  }

  recomputeStatuses(validated);

  const notes: string[] = [];
  if (groups.size > 0) {
    const balanced = [...groups.values()].filter((group) =>
      group.rows.every((row) => row.errors.length === 0),
    ).length;
    if (balanced > 0) {
      notes.push(
        `${balanced} écriture${balanced > 1 ? "s" : ""} en brouillon ${balanced > 1 ? "seront" : "sera"} créée${balanced > 1 ? "s" : ""} à la confirmation, sans validation.`,
      );
    }
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}
