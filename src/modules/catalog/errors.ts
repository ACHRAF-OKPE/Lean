export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export class ImportFileError extends CatalogError {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}
