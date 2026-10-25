const xofFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "XOF",
  maximumFractionDigits: 0,
});

export function formatXof(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("Un montant XOF doit être un entier sûr.");
  }
  return xofFormatter.format(amount);
}
