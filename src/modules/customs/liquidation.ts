import type { CustomsTaxBase } from "@/db/schema";
import { MAX_XOF_AMOUNT } from "@/modules/catalog/constants";
import { isTecRate } from "./constants";
import { CustomsError } from "./errors";

export interface LiquidationLineInput {
  readonly lineNumber: number;
  readonly valueXof: number;
  readonly tecRate: number | null;
}

export interface LiquidationTaxInput {
  readonly code: string;
  readonly label: string;
  readonly base: CustomsTaxBase;
  readonly rateBp: number;
  readonly position: number;
}

export interface LiquidatedLine {
  readonly lineNumber: number;
  readonly cifValue: number;
  readonly dutyRate: number;
  readonly dutyAmount: number;
}

export interface LiquidatedTax {
  readonly code: string;
  readonly label: string;
  readonly base: CustomsTaxBase;
  readonly baseAmount: number;
  readonly rateBp: number;
  readonly amount: number;
  readonly position: number;
}

export interface LiquidationResult {
  readonly lines: readonly LiquidatedLine[];
  readonly taxes: readonly LiquidatedTax[];
  readonly cifTotal: number;
  readonly dutyTotal: number;
  readonly taxTotal: number;
  readonly grandTotal: number;
}

function toBigInt(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CustomsError(`${label} : montant XOF entier positif attendu.`);
  }
  return BigInt(value);
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function allocateProRata(total: number, weights: readonly number[]): readonly number[] {
  const bigTotal = toBigInt(total, "Frais à répartir");
  if (weights.length === 0) {
    return [];
  }
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new CustomsError(
        "Répartition : les valeurs de ligne doivent être entières et positives.",
      );
    }
  }

  const bigWeights = weights.map((weight) => BigInt(weight));
  const sum = bigWeights.reduce((acc, weight) => acc + weight, 0n);

  if (bigTotal === 0n) {
    return weights.map(() => 0);
  }

  if (sum === 0n) {
    const count = BigInt(weights.length);
    const base = bigTotal / count;
    const extra = Number(bigTotal % count);
    return weights.map((_, index) => Number(base) + (index < extra ? 1 : 0));
  }

  const floors = bigWeights.map((weight) => {
    const numerator = bigTotal * weight;
    return { floor: numerator / sum, remainder: numerator % sum };
  });

  const assigned = floors.reduce((acc, share) => acc + share.floor, 0n);
  const leftover = Number(bigTotal - assigned);
  const order = floors
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((left, right) =>
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1,
    );

  for (let index = 0; index < leftover; index += 1) {
    const target = order[index];
    if (target) {
      floors[target.index]!.floor += 1n;
    }
  }

  return floors.map((share) => Number(share.floor));
}

export function liquidateDeclaration(input: {
  readonly freightAmountXof: number;
  readonly insuranceAmountXof: number;
  readonly lines: readonly LiquidationLineInput[];
  readonly taxes: readonly LiquidationTaxInput[];
}): LiquidationResult {
  if (input.lines.length === 0) {
    throw new CustomsError("La déclaration ne contient aucune ligne à liquider.");
  }
  if (
    !Number.isSafeInteger(input.freightAmountXof) ||
    input.freightAmountXof < 0 ||
    input.freightAmountXof > MAX_XOF_AMOUNT
  ) {
    throw new CustomsError("Frais de transport : montant XOF entier attendu.");
  }
  if (
    !Number.isSafeInteger(input.insuranceAmountXof) ||
    input.insuranceAmountXof < 0 ||
    input.insuranceAmountXof > MAX_XOF_AMOUNT
  ) {
    throw new CustomsError("Frais d'assurance : montant XOF entier attendu.");
  }

  const missingRates = input.lines
    .filter((line) => line.tecRate === null || !isTecRate(line.tecRate))
    .map((line) => line.lineNumber);
  if (missingRates.length > 0) {
    throw new CustomsError(
      `Taux TEC manquant pour la ou les lignes ${missingRates.join(", ")} : renseignez le taux du code SH dans la nomenclature avant de liquider.`,
    );
  }

  const values = input.lines.map((line) => {
    if (
      !Number.isSafeInteger(line.valueXof) ||
      line.valueXof < 0 ||
      line.valueXof > MAX_XOF_AMOUNT
    ) {
      throw new CustomsError(
        `Ligne ${line.lineNumber} : valeur XOF entière comprise entre 0 et ${MAX_XOF_AMOUNT} attendue.`,
      );
    }
    return line.valueXof;
  });

  const freightShares = allocateProRata(input.freightAmountXof, values);
  const insuranceShares = allocateProRata(input.insuranceAmountXof, values);

  const lines: LiquidatedLine[] = input.lines.map((line, index) => {
    const cifValue = line.valueXof + (freightShares[index] ?? 0) + (insuranceShares[index] ?? 0);
    const dutyRate = line.tecRate ?? 0;
    const dutyAmount = Number(roundHalfUp(BigInt(cifValue) * BigInt(dutyRate), 100n));
    return { lineNumber: line.lineNumber, cifValue, dutyRate, dutyAmount };
  });

  const cifTotal = lines.reduce((acc, line) => acc + line.cifValue, 0);
  const dutyTotal = lines.reduce((acc, line) => acc + line.dutyAmount, 0);

  const taxes: LiquidatedTax[] = [...input.taxes]
    .sort((left, right) =>
      left.position === right.position
        ? left.code.localeCompare(right.code)
        : left.position - right.position,
    )
    .map((tax) => {
      if (!Number.isSafeInteger(tax.rateBp) || tax.rateBp < 0 || tax.rateBp > 10_000) {
        throw new CustomsError(`Taxe ${tax.code} : taux entre 0 et 100 % attendu.`);
      }
      const baseAmount = tax.base === "cif" ? cifTotal : cifTotal + dutyTotal;
      const amount =
        tax.rateBp === 0
          ? 0
          : Number(roundHalfUp(BigInt(baseAmount) * BigInt(tax.rateBp), 10_000n));
      return {
        code: tax.code,
        label: tax.label,
        base: tax.base,
        baseAmount,
        rateBp: tax.rateBp,
        amount,
        position: tax.position,
      };
    });

  const taxTotal = taxes.reduce((acc, tax) => acc + tax.amount, 0);

  return {
    lines,
    taxes,
    cifTotal,
    dutyTotal,
    taxTotal,
    grandTotal: dutyTotal + taxTotal,
  };
}
