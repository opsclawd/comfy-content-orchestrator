export class IdempotencyConflictError extends Error {
  override readonly name = "IdempotencyConflictError";
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `Idempotency conflict for action ID '${eventId}': action ID was already processed with a different request payload hash.`
    );
    this.eventId = eventId;
  }
}
