export class InvalidJobCompletionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobCompletionPayloadError";
  }
}

export class JobDispatchUnavailableError extends Error {
  constructor(message = "Job queue is not configured for candidate generation dispatch.") {
    super(message);
    this.name = "JobDispatchUnavailableError";
  }
}
