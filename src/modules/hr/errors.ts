export class HrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HrError";
  }
}
