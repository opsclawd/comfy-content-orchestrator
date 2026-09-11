export class InvalidSceneOrdinalSequenceError extends Error {
  override readonly name = "InvalidSceneOrdinalSequenceError";
  readonly campaignId: string;
  readonly ordinals: readonly number[];

  constructor(campaignId: string, ordinals: readonly number[], reason: string) {
    super(
      `Invalid scene ordinal sequence for campaign '${campaignId}': ${reason}. Received ordinals: [${ordinals.join(", ")}].`
    );
    this.campaignId = campaignId;
    this.ordinals = ordinals;
  }
}
