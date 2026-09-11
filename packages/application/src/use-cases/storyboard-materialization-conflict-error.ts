export class StoryboardMaterializationConflictError extends Error {
  override readonly name = "StoryboardMaterializationConflictError";
  readonly campaignId: string;
  readonly reason: string;

  constructor(campaignId: string, reason: string) {
    super(`Campaign '${campaignId}' storyboard materialization conflict: ${reason}`);
    this.campaignId = campaignId;
    this.reason = reason;
  }
}
