export class InvalidTargetDurationError extends Error {
  override readonly name = "InvalidTargetDurationError";
  readonly targetTotalDurationMs: number;

  constructor(targetTotalDurationMs: number) {
    super(
      `Invalid targetTotalDurationMs '${targetTotalDurationMs}'. Must be an integer between 5000 and 300000 ms.`
    );
    this.targetTotalDurationMs = targetTotalDurationMs;
  }
}
