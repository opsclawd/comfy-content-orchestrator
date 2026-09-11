export class CampaignIdempotencyConflictError extends Error {
  override readonly name = "CampaignIdempotencyConflictError";
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      `Idempotency conflict for campaign key '${idempotencyKey}': key was already used with a different request payload hash.`
    );
    this.idempotencyKey = idempotencyKey;
  }
}
