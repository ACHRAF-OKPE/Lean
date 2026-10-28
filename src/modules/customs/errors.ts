export class CustomsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomsError";
  }
}
