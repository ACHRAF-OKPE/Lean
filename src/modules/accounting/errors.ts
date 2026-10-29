export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}
