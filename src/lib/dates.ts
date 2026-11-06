const abidjanDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Abidjan",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayIsoDate(now: Date = new Date()): string {
  return abidjanDay.format(now);
}

export function isoDateYear(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

export function isoDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Décale une date ISO d'un nombre de jours, en temps universel, sans dépendre du fuseau local. */
export function isoDatePlusDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-");
  const base = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
