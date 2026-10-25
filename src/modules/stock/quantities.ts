export const QUANTITY_SCALE = 6;
export const MAX_QUANTITY = "1000000000";

const MICROS = 1_000_000n;
const MAX_QUANTITY_MICROS = 1_000_000_000n * MICROS;

export interface QuantityParseResult {
  readonly value: string | null;
  readonly micros: bigint | null;
  readonly errors: string[];
  readonly warnings: string[];
}

function rawText(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "";
  }
  if (typeof raw === "number") {
    return String(raw);
  }
  return String(raw).trim();
}

export function quantityToMicros(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(QUANTITY_SCALE, "0").slice(0, QUANTITY_SCALE);
  return BigInt(whole) * MICROS + BigInt(padded || "0");
}

export function microsToQuantity(micros: bigint): string {
  const sign = micros < 0n ? "-" : "";
  const absolute = micros < 0n ? -micros : micros;
  const whole = absolute / MICROS;
  const fraction = (absolute % MICROS).toString().padStart(QUANTITY_SCALE, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return `${sign}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

export function normalizeQuantity(value: string): string {
  return microsToQuantity(quantityToMicros(value));
}

export function parseQuantity(
  raw: unknown,
  label = "Quantité",
  options: { allowZero?: boolean } = {},
): QuantityParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let text = rawText(raw);

  if (!text) {
    errors.push(`${label} : obligatoire.`);
    return { value: null, micros: null, errors, warnings };
  }

  if (text.includes(",") && !text.includes(".")) {
    warnings.push(`${label} : virgule décimale convertie en point.`);
    text = text.replace(",", ".");
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    errors.push(`${label} : nombre décimal attendu, sans exposant ni séparateur de milliers.`);
    return { value: null, micros: null, errors, warnings };
  }

  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  if (fraction.length > QUANTITY_SCALE) {
    errors.push(`${label} : ${QUANTITY_SCALE} décimales maximum.`);
    return { value: null, micros: null, errors, warnings };
  }
  if (sign === "-") {
    errors.push(`${label} : doit être strictement positive.`);
    return { value: null, micros: null, errors, warnings };
  }

  const trimmedFraction = fraction.replace(/0+$/, "");
  const value = `${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
  const micros = quantityToMicros(value);

  if (micros === 0n && !options.allowZero) {
    errors.push(`${label} : doit être strictement positive.`);
    return { value: null, micros: null, errors, warnings };
  }
  if (micros > MAX_QUANTITY_MICROS) {
    errors.push(`${label} : ${MAX_QUANTITY} maximum.`);
    return { value: null, micros: null, errors, warnings };
  }

  return { value, micros, errors, warnings };
}

export function compareQuantity(left: string, right: string): number {
  const a = quantityToMicros(left);
  const b = quantityToMicros(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

export function addQuantity(left: string, right: string): string {
  return microsToQuantity(quantityToMicros(left) + quantityToMicros(right));
}

export function subtractQuantity(left: string, right: string): string {
  return microsToQuantity(quantityToMicros(left) - quantityToMicros(right));
}

export function isZeroQuantity(value: string): boolean {
  return quantityToMicros(value) === 0n;
}

export function computeLineTotal(qty: string, unitPriceXof: number): number {
  const micros = quantityToMicros(qty);
  const total = (micros * BigInt(unitPriceXof) + MICROS / 2n) / MICROS;
  return Number(total);
}

const integerFormatter = new Intl.NumberFormat("fr-FR");

export function formatQuantity(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const grouped = integerFormatter.format(BigInt(whole));
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped},${trimmed}` : grouped;
}

export function remainingQuantity(ordered: string, received: string): string {
  const remaining = quantityToMicros(ordered) - quantityToMicros(received);
  return microsToQuantity(remaining > 0n ? remaining : 0n);
}
