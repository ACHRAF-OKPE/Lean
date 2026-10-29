export type SupplyGrouping = "supplier" | "supplier_date";

export interface SupplyGroupableLine {
  readonly id: string;
  readonly supplierId: string;
  readonly needDate: string;
}

export interface SupplyLineGroup<T extends SupplyGroupableLine> {
  readonly key: string;
  readonly supplierId: string;
  readonly needDate: string;
  readonly lines: readonly T[];
}

export function parseSupplyGrouping(raw: unknown): SupplyGrouping | null {
  return raw === "supplier" || raw === "supplier_date" ? raw : null;
}

export function groupSupplyLines<T extends SupplyGroupableLine>(
  lines: readonly T[],
  grouping: SupplyGrouping,
): readonly SupplyLineGroup<T>[] {
  const groups = new Map<string, { supplierId: string; needDate: string; lines: T[] }>();

  for (const line of lines) {
    const key = grouping === "supplier" ? line.supplierId : `${line.supplierId}|${line.needDate}`;
    const group = groups.get(key);
    if (group) {
      group.lines.push(line);
      if (line.needDate < group.needDate) {
        group.needDate = line.needDate;
      }
    } else {
      groups.set(key, { supplierId: line.supplierId, needDate: line.needDate, lines: [line] });
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      supplierId: group.supplierId,
      needDate: group.needDate,
      lines: group.lines,
    }))
    .sort(
      (left, right) =>
        left.supplierId.localeCompare(right.supplierId) ||
        left.needDate.localeCompare(right.needDate),
    );
}
