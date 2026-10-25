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
