"use client";

import { useActionState, useRef, useState } from "react";
import {
  BookOpen,
  CalendarPlus,
  Check,
  Link2,
  LoaderCircle,
  Lock,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { EMPTY_ACCOUNTING_FORM_STATE } from "@/lib/accounting/form-state";
import {
  closeFiscalYearAction,
  createAccountAction,
  createEntryAction,
  createFiscalYearAction,
  createJournalAction,
  deleteEntryAction,
  letterLinesAction,
  postCutoffAction,
  saveAccountingSettingsAction,
  toggleAccountAction,
  toggleJournalAction,
  unletterGroupAction,
  validateEntryAction,
} from "@/lib/accounting/actions";
import { formatXof } from "@/lib/money";
import {
  ACCOUNTING_JOURNAL_TYPES,
  ACCOUNTING_JOURNAL_TYPE_LABELS,
  MAX_JOURNAL_ENTRY_LINES,
} from "@/modules/accounting/constants";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

function amountValue(raw: string): number {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned.length === 0) {
    return 0;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  const rounded = Math.round(parsed);
  return Number.isSafeInteger(rounded) ? rounded : 0;
}

export function FiscalYearForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(
    createFiscalYearAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] md:items-end"
      >
        <legend className="sr-only">Nouvel exercice comptable</legend>
        <Field label="Libellé" htmlFor="fiscal-year-label" hint="60 caractères maximum.">
          <input
            id="fiscal-year-label"
            name="label"
            required
            maxLength={60}
            placeholder="Exercice 2027"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Début" htmlFor="fiscal-year-start" hint="AAAA-MM-JJ.">
          <input
            id="fiscal-year-start"
            name="startsOn"
            type="date"
            required
            defaultValue={today}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Fin" htmlFor="fiscal-year-end" hint="366 jours au plus.">
          <input id="fiscal-year-end" name="endsOn" type="date" required className={INPUT_CLASS} />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Créer l'exercice comptable"
          title="Créer l'exercice"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={CalendarPlus} />
        </button>
      </fieldset>
    </form>
  );
}

export function CloseFiscalYearButton({
  fiscalYearId,
  label,
}: {
  fiscalYearId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    closeFiscalYearAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="fiscalYearId" value={fiscalYearId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Clôturer ${label}`}
        title="Clôturer l'exercice"
        className={SECONDARY}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Lock className="size-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function AccountForm() {
  const [state, formAction, pending] = useActionState(
    createAccountAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1.8fr)_minmax(0,0.8fr)_auto] md:items-end"
      >
        <legend className="sr-only">Nouveau compte comptable</legend>
        <Field label="Code" htmlFor="account-code" hint="Classe 1 à 8, ex. 411000.">
          <input
            id="account-code"
            name="code"
            required
            maxLength={10}
            inputMode="numeric"
            placeholder="411000"
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>
        <Field label="Libellé" htmlFor="account-label" hint="120 caractères maximum.">
          <input
            id="account-label"
            name="label"
            required
            maxLength={120}
            placeholder="Clients"
            className={INPUT_CLASS}
          />
        </Field>
        <CheckboxField name="active" label="Compte actif" hint="Actif par défaut." />
        <button
          type="submit"
          disabled={pending}
          aria-label="Créer le compte comptable"
          title="Créer le compte"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Plus} />
        </button>
      </fieldset>
    </form>
  );
}

export function AccountToggleButton({
  accountId,
  code,
  active,
}: {
  accountId: string;
  code: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    toggleAccountAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={active ? `Désactiver le compte ${code}` : `Activer le compte ${code}`}
        title={active ? "Désactiver" : "Activer"}
        className={`grid size-7 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          active
            ? "border-line bg-panel text-muted hover:border-copper/30 hover:text-copper"
            : "border-brand/20 bg-brand-soft text-brand-strong hover:border-brand/40"
        }`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Power className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function JournalForm() {
  const [state, formAction, pending] = useActionState(
    createJournalAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,0.5fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_auto] md:items-end"
      >
        <legend className="sr-only">Nouveau journal comptable</legend>
        <Field label="Code" htmlFor="journal-code" hint="2 à 6 caractères, ex. VE.">
          <input
            id="journal-code"
            name="code"
            required
            maxLength={6}
            placeholder="VE"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Libellé" htmlFor="journal-label" hint="120 caractères maximum.">
          <input
            id="journal-label"
            name="label"
            required
            maxLength={120}
            placeholder="Journal des ventes"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Type" htmlFor="journal-type">
          <select
            id="journal-type"
            name="type"
            required
            defaultValue="sale"
            className={INPUT_CLASS}
          >
            {ACCOUNTING_JOURNAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACCOUNTING_JOURNAL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Créer le journal comptable"
          title="Créer le journal"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Plus} />
        </button>
      </fieldset>
    </form>
  );
}

export function JournalToggleButton({
  journalId,
  code,
  active,
}: {
  journalId: string;
  code: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    toggleJournalAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="journalId" value={journalId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={active ? `Désactiver le journal ${code}` : `Activer le journal ${code}`}
        title={active ? "Désactiver" : "Activer"}
        className={`grid size-7 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          active
            ? "border-line bg-panel text-muted hover:border-copper/30 hover:text-copper"
            : "border-brand/20 bg-brand-soft text-brand-strong hover:border-brand/40"
        }`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Power className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export interface EntryFormOptions {
  readonly journals: readonly { id: string; code: string; label: string }[];
  readonly accounts: readonly { id: string; code: string; label: string }[];
  readonly partners: readonly { id: string; code: string; name: string }[];
}

interface LineDraft {
  readonly key: number;
  readonly accountId: string;
  readonly partnerId: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
}

const EMPTY_LINE: Omit<LineDraft, "key"> = {
  accountId: "",
  partnerId: "",
  label: "",
  debit: "",
  credit: "",
};

export function EntryForm({ options, today }: { options: EntryFormOptions; today: string }) {
  const [state, formAction, pending] = useActionState(
    createEntryAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );
  const nextKey = useRef(3);
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 1, ...EMPTY_LINE },
    { key: 2, ...EMPTY_LINE },
  ]);

  const debitTotal = lines.reduce((sum, line) => sum + amountValue(line.debit), 0);
  const creditTotal = lines.reduce((sum, line) => sum + amountValue(line.credit), 0);
  const balanced = debitTotal > 0 && debitTotal === creditTotal;

  function updateLine(key: number, patch: Partial<Omit<LineDraft, "key">>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => {
      if (current.length >= MAX_JOURNAL_ENTRY_LINES) {
        return current;
      }
      const key = nextKey.current;
      nextKey.current += 1;
      return [...current, { key, ...EMPTY_LINE }];
    });
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length <= 2 ? current : current.filter((line) => line.key !== key),
    );
  }

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-line bg-panel p-5">
      <FormErrors errors={state.errors} />

      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Nouvelle écriture</h2>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        L&apos;écriture est créée en brouillon, numérotée par journal et par exercice, puis validée
        depuis sa fiche. Débit et crédit doivent s&apos;équilibrer.
      </p>

      <fieldset disabled={pending} className="mt-4 space-y-4">
        <legend className="sr-only">En-tête de l&apos;écriture</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Journal" htmlFor="entry-journal" hint="Journal actif uniquement.">
            <select
              id="entry-journal"
              name="journalId"
              required
              defaultValue={options.journals[0]?.id ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un journal
              </option>
              {options.journals.map((journal) => (
                <option key={journal.id} value={journal.id}>
                  {journal.code} · {journal.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Date comptable"
            htmlFor="entry-date"
            hint="Doit tomber dans un exercice ouvert."
          >
            <input
              id="entry-date"
              name="entryDate"
              type="date"
              required
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Référence"
            htmlFor="entry-reference"
            hint="60 caractères maximum, facultative."
          >
            <input
              id="entry-reference"
              name="reference"
              maxLength={60}
              placeholder="FAC-2026-014"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Libellé" htmlFor="entry-label" hint="160 caractères maximum.">
            <input
              id="entry-label"
              name="label"
              required
              maxLength={160}
              placeholder="Vente de marchandises"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium">Lignes d&apos;écriture</h3>
            <button
              type="button"
              onClick={addLine}
              disabled={lines.length >= MAX_JOURNAL_ENTRY_LINES}
              aria-label="Ajouter une ligne"
              title="Ajouter une ligne"
              className={SECONDARY}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-2 rounded-lg border border-line bg-canvas/40 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] md:items-end"
            >
              <Field label={`Compte ${index + 1}`} htmlFor={`entry-account-${line.key}`}>
                <select
                  id={`entry-account-${line.key}`}
                  name="compte"
                  required
                  value={line.accountId}
                  onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="" disabled>
                    Compte
                  </option>
                  {options.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tiers" htmlFor={`entry-partner-${line.key}`}>
                <select
                  id={`entry-partner-${line.key}`}
                  name="tiers"
                  value={line.partnerId}
                  onChange={(event) => updateLine(line.key, { partnerId: event.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="">Sans tiers</option>
                  {options.partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.code} · {partner.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Libellé de ligne" htmlFor={`entry-line-label-${line.key}`}>
                <input
                  id={`entry-line-label-${line.key}`}
                  name="libelle_ligne"
                  maxLength={120}
                  value={line.label}
                  onChange={(event) => updateLine(line.key, { label: event.target.value })}
                  placeholder="Facture FAC-2026-014"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Débit" htmlFor={`entry-debit-${line.key}`}>
                <input
                  id={`entry-debit-${line.key}`}
                  name="debit"
                  inputMode="numeric"
                  value={line.debit}
                  onChange={(event) => updateLine(line.key, { debit: event.target.value })}
                  placeholder="0"
                  className={`${INPUT_CLASS} tabular-nums`}
                />
              </Field>
              <Field label="Crédit" htmlFor={`entry-credit-${line.key}`}>
                <input
                  id={`entry-credit-${line.key}`}
                  name="credit"
                  inputMode="numeric"
                  value={line.credit}
                  onChange={(event) => updateLine(line.key, { credit: event.target.value })}
                  placeholder="0"
                  className={`${INPUT_CLASS} tabular-nums`}
                />
              </Field>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length <= 2}
                aria-label={`Supprimer la ligne ${index + 1}`}
                title="Supprimer la ligne"
                className={`${SECONDARY} disabled:opacity-40`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-4 text-[11px] tabular-nums">
            <span>
              Débit <span className="font-mono">{formatXof(debitTotal)}</span>
            </span>
            <span>
              Crédit <span className="font-mono">{formatXof(creditTotal)}</span>
            </span>
            <span
              className={
                balanced
                  ? "text-brand-strong"
                  : debitTotal === 0 && creditTotal === 0
                    ? "text-muted"
                    : "text-copper"
              }
            >
              {balanced
                ? "Équilibrée"
                : debitTotal === 0 && creditTotal === 0
                  ? "Saisissez les montants"
                  : "Déséquilibrée"}
            </span>
          </div>
          <button
            type="submit"
            disabled={pending}
            aria-label="Créer l'écriture en brouillon"
            title="Créer l'écriture"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function ValidateEntryButton({ entryId }: { entryId: string }) {
  const [state, formAction, pending] = useActionState(
    validateEntryAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="entryId" value={entryId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label="Valider l'écriture"
        title="Valider l'écriture"
        className={SUBMIT}
      >
        <SubmitIcon pending={pending} icon={Check} />
      </button>
    </form>
  );
}

export function DeleteEntryButton({ entryId, number }: { entryId: string; number: string }) {
  const [state, formAction, pending] = useActionState(
    deleteEntryAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="entryId" value={entryId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Supprimer le brouillon ${number}`}
        title="Supprimer le brouillon"
        className={SECONDARY}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export interface SettingsJournalOption {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly type: string;
}

export interface SettingsAccountOption {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
}

export interface SettingsValues {
  readonly salesJournalId: string | null;
  readonly purchaseJournalId: string | null;
  readonly bankJournalId: string | null;
  readonly customerAccountId: string | null;
  readonly supplierAccountId: string | null;
  readonly salesAccountId: string | null;
  readonly purchaseAccountId: string | null;
  readonly bankAccountId: string | null;
}

export function AccountingSettingsForm({
  journals,
  accounts,
  values,
}: {
  journals: readonly SettingsJournalOption[];
  accounts: readonly SettingsAccountOption[];
  values: SettingsValues | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveAccountingSettingsAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  const journalsOfType = (type: string) => journals.filter((journal) => journal.type === type);
  const accountsOfClass = (accountClass: number) =>
    accounts.filter((account) => account.accountClass === accountClass);

  const selects = [
    {
      name: "salesJournalId",
      label: "Journal des ventes",
      hint: "Type vente, actif.",
      options: journalsOfType("sale"),
      current: values?.salesJournalId ?? null,
    },
    {
      name: "purchaseJournalId",
      label: "Journal des achats",
      hint: "Type achat, actif.",
      options: journalsOfType("purchase"),
      current: values?.purchaseJournalId ?? null,
    },
    {
      name: "bankJournalId",
      label: "Journal de banque",
      hint: "Type banque, actif.",
      options: journalsOfType("bank"),
      current: values?.bankJournalId ?? null,
    },
    {
      name: "customerAccountId",
      label: "Compte client",
      hint: "Classe 4, actif.",
      options: accountsOfClass(4),
      current: values?.customerAccountId ?? null,
    },
    {
      name: "supplierAccountId",
      label: "Compte fournisseur",
      hint: "Classe 4, actif.",
      options: accountsOfClass(4),
      current: values?.supplierAccountId ?? null,
    },
    {
      name: "salesAccountId",
      label: "Compte de vente",
      hint: "Classe 7, actif.",
      options: accountsOfClass(7),
      current: values?.salesAccountId ?? null,
    },
    {
      name: "purchaseAccountId",
      label: "Compte d'achat",
      hint: "Classe 6, actif.",
      options: accountsOfClass(6),
      current: values?.purchaseAccountId ?? null,
    },
    {
      name: "bankAccountId",
      label: "Compte de banque",
      hint: "Classe 5, actif.",
      options: accountsOfClass(5),
      current: values?.bankAccountId ?? null,
    },
  ] as const;

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage comptable</legend>
        <div className="grid gap-4 md:grid-cols-3">
          {selects.map((select) => (
            <Field
              key={select.name}
              label={select.label}
              htmlFor={`settings-${select.name}`}
              hint={select.hint}
            >
              <select
                id={`settings-${select.name}`}
                name={select.name}
                required
                defaultValue={select.current ?? ""}
                className={INPUT_CLASS}
              >
                <option value="" disabled>
                  Sélectionner
                </option>
                {select.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le paramétrage comptable"
            title="Enregistrer"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export interface LetteringCandidateRow {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly accountCode: string;
  readonly partnerName: string | null;
  readonly label: string | null;
  readonly debit: number;
  readonly credit: number;
}

export function LetteringTable({ candidates }: { candidates: readonly LetteringCandidateRow[] }) {
  const [state, formAction, pending] = useActionState(
    letterLinesAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function toggle(lineId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  }

  const chosen = candidates.filter((candidate) => selected.has(candidate.lineId));
  const debitTotal = chosen.reduce((sum, candidate) => sum + candidate.debit, 0);
  const creditTotal = chosen.reduce((sum, candidate) => sum + candidate.credit, 0);
  const balanced = debitTotal > 0 && debitTotal === creditTotal;

  return (
    <form action={formAction}>
      <FormErrors errors={state.errors} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <caption className="sr-only">Lignes de tiers à lettrer</caption>
          <thead>
            <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
              <th scope="col" className="px-4 py-2.5 font-normal">
                Lettre
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Écriture
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Compte
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Tiers
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Libellé
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">
                Débit
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">
                Crédit
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.lineId} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    name="ligne"
                    value={candidate.lineId}
                    checked={selected.has(candidate.lineId)}
                    onChange={() => toggle(candidate.lineId)}
                    aria-label={`Sélectionner la ligne ${candidate.entryNumber}`}
                    className="size-3.5 accent-brand"
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                  {candidate.entryNumber}
                  <span className="block font-sans text-[10px] text-muted tabular-nums">
                    {candidate.entryDate}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px]">{candidate.accountCode}</td>
                <td className="px-4 py-2.5">{candidate.partnerName ?? "—"}</td>
                <td className="px-4 py-2.5 text-[10px] text-muted">{candidate.label ?? "—"}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {candidate.debit > 0 ? formatXof(candidate.debit) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {candidate.credit > 0 ? formatXof(candidate.credit) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <div className="flex items-center gap-4 text-[11px] tabular-nums">
          <span>
            Sélection <span className="font-mono">{chosen.length}</span>
          </span>
          <span>
            Débit <span className="font-mono">{formatXof(debitTotal)}</span>
          </span>
          <span>
            Crédit <span className="font-mono">{formatXof(creditTotal)}</span>
          </span>
          <span className={balanced ? "text-brand-strong" : "text-muted"}>
            {balanced ? "Équilibrée" : "Sélection déséquilibrée"}
          </span>
        </div>
        <button
          type="submit"
          disabled={pending || !balanced}
          aria-label="Lettrer les lignes sélectionnées"
          title="Lettrer"
          className={`${SUBMIT} disabled:opacity-40`}
        >
          <SubmitIcon pending={pending} icon={Link2} />
        </button>
      </div>
    </form>
  );
}

export function UnletterButton({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState(
    unletterGroupAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="code" value={code} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Délettrer ${code}`}
        title="Délettrer le groupe"
        className={SECONDARY}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Unlink className="size-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

export function PostCutoffButton({
  fiscalYearId,
  unpostedCount,
}: {
  fiscalYearId: string;
  unpostedCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    postCutoffAction,
    EMPTY_ACCOUNTING_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="fiscalYearId" value={fiscalYearId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending || unpostedCount === 0}
        aria-label="Comptabiliser les documents non comptabilisés"
        title="Comptabiliser les documents en attente"
        className={`${SUBMIT} disabled:opacity-40`}
      >
        <SubmitIcon pending={pending} icon={RefreshCw} />
      </button>
    </form>
  );
}
