import { AccountingError } from "./errors";

export interface AccountBalance {
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly accountClass: number;
  readonly debit: number;
  readonly credit: number;
}

export interface ClosingLine {
  readonly accountId: string;
  readonly partnerId: null;
  readonly label: string;
  readonly debit: number;
  readonly credit: number;
}

export interface ResultSummary {
  readonly charges: number;
  readonly produits: number;
  readonly result: number;
}

export interface ResultAccountRef {
  readonly id: string;
  readonly code: string;
}

function netOf(balance: AccountBalance): number {
  return balance.debit - balance.credit;
}

export function summarizeResult(balances: readonly AccountBalance[]): ResultSummary {
  let charges = 0;
  let produits = 0;
  for (const balance of balances) {
    const net = netOf(balance);
    if (balance.accountClass === 6) {
      charges += net;
    } else if (balance.accountClass === 7) {
      produits -= net;
    } else if (balance.accountClass === 8) {
      if (net >= 0) {
        charges += net;
      } else {
        produits -= net;
      }
    }
  }
  return { charges, produits, result: produits - charges };
}

export function hasResultActivity(balances: readonly AccountBalance[]): boolean {
  return balances.some(
    (balance) => balance.accountClass >= 6 && balance.accountClass <= 8 && netOf(balance) !== 0,
  );
}

export function hasBalanceSheetActivity(balances: readonly AccountBalance[]): boolean {
  return balances.some(
    (balance) => balance.accountClass >= 1 && balance.accountClass <= 5 && netOf(balance) !== 0,
  );
}

export function planClosingEntry(
  balances: readonly AccountBalance[],
  resultAccount: ResultAccountRef | null,
): readonly ClosingLine[] {
  const { result } = summarizeResult(balances);
  if (result !== 0 && !resultAccount) {
    throw new AccountingError("Le compte de résultat (131 ou 139) est requis pour cette clôture.");
  }

  const lines: ClosingLine[] = [];
  for (const balance of balances) {
    if (balance.accountClass < 6) {
      continue;
    }
    const net = netOf(balance);
    if (net === 0) {
      continue;
    }
    lines.push({
      accountId: balance.accountId,
      partnerId: null,
      label: `Solde ${balance.code}`,
      debit: net < 0 ? -net : 0,
      credit: net > 0 ? net : 0,
    });
  }

  if (result !== 0 && resultAccount) {
    lines.push({
      accountId: resultAccount.id,
      partnerId: null,
      label: result > 0 ? "Résultat net : bénéfice" : "Résultat net : perte",
      debit: result < 0 ? -result : 0,
      credit: result > 0 ? result : 0,
    });
  }

  return lines;
}

export function planOpeningEntry(balances: readonly AccountBalance[]): readonly ClosingLine[] {
  const lines: ClosingLine[] = [];
  for (const balance of balances) {
    if (balance.accountClass < 1 || balance.accountClass > 5) {
      continue;
    }
    const net = netOf(balance);
    if (net === 0) {
      continue;
    }
    lines.push({
      accountId: balance.accountId,
      partnerId: null,
      label: `À-nouveaux ${balance.code}`,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    });
  }
  return lines;
}

export function nextIsoDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
