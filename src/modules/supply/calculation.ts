import { microsToQuantity, quantityToMicros } from "@/modules/stock/quantities";

export interface SupplyMovementEvent {
  readonly date: string | null;
  readonly direction: "in" | "out";
  readonly qty: string;
}

export interface SupplyCalculationParams {
  readonly today: string;
  readonly horizonDays: number;
  readonly stockQty: string;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly orderMultipleQty: string | null;
  readonly leadTimeDays: number;
  readonly safetyDelayDays: number;
  readonly events: readonly SupplyMovementEvent[];
}

export interface SupplyProposalCalculation {
  readonly proposedQty: string;
  readonly needDate: string;
  readonly orderDate: string;
  readonly late: boolean;
  readonly projectedQty: string;
  readonly incomingQty: string;
  readonly outgoingQty: string;
}

export function addIsoDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function laterDate(left: string, right: string): string {
  return left > right ? left : right;
}

function ceilToMultiple(value: bigint, multiple: bigint): bigint {
  if (multiple <= 0n) {
    return value;
  }
  const remainder = value % multiple;
  return remainder === 0n ? value : value + (multiple - remainder);
}

function emptyDay() {
  return { incoming: 0n, outgoing: 0n };
}

export function computeSupplyProposal(
  params: SupplyCalculationParams,
): SupplyProposalCalculation | null {
  const horizonEnd = addIsoDays(params.today, params.horizonDays);
  const byDate = new Map<string, { incoming: bigint; outgoing: bigint }>();
  let incoming = 0n;
  let outgoing = 0n;

  for (const event of params.events) {
    const micros = quantityToMicros(event.qty);
    if (micros === 0n) {
      continue;
    }
    const dueDate = laterDate(event.date ?? params.today, params.today);
    if (dueDate > horizonEnd) {
      continue;
    }
    const day = byDate.get(dueDate) ?? emptyDay();
    if (event.direction === "in") {
      day.incoming += micros;
      incoming += micros;
    } else {
      day.outgoing += micros;
      outgoing += micros;
    }
    byDate.set(dueDate, day);
  }

  const minStock = quantityToMicros(params.minStockQty);
  const reorder = quantityToMicros(params.reorderQty);
  const multiple = params.orderMultipleQty ? quantityToMicros(params.orderMultipleQty) : 0n;
  const dates = [...byDate.keys()].sort();

  const proposalAt = (needDate: string, balance: bigint): SupplyProposalCalculation => {
    const gap = minStock - balance;
    const base = gap > reorder ? gap : reorder;
    const proposed = ceilToMultiple(base, multiple);
    const leadStockDays = params.leadTimeDays + params.safetyDelayDays;
    const theoretical = addIsoDays(needDate, -leadStockDays);
    const late = theoretical < params.today;
    return {
      proposedQty: microsToQuantity(proposed),
      needDate,
      orderDate: late ? params.today : theoretical,
      late,
      projectedQty: microsToQuantity(balance),
      incomingQty: microsToQuantity(incoming),
      outgoingQty: microsToQuantity(outgoing),
    };
  };

  let balance = quantityToMicros(params.stockQty);
  if (balance < minStock) {
    return proposalAt(params.today, balance);
  }

  for (const date of dates) {
    const day = byDate.get(date);
    if (!day) {
      continue;
    }
    balance += day.incoming - day.outgoing;
    if (balance < minStock) {
      return proposalAt(date, balance);
    }
  }

  return null;
}

export function validateHorizon(raw: unknown): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return value >= 1 && value <= 365 ? value : null;
}
