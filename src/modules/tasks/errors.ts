export class TasksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TasksError";
  }
}
