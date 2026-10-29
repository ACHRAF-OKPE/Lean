export class TenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenderError";
  }
}
