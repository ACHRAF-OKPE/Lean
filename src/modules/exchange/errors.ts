export class ExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeError";
  }
}
