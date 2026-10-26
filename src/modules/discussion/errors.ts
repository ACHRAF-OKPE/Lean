export class DiscussionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscussionError";
  }
}
