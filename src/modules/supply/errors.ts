export class SupplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplyError";
  }
}
