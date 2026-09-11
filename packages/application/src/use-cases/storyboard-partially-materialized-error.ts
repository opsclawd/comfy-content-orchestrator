export class StoryboardPartiallyMaterializedError extends Error {
  override readonly name = "StoryboardPartiallyMaterializedError";
  readonly campaignId: string;
  readonly expectedCount: number;
  readonly actualCount: number;

  constructor(campaignId: string, expectedCount: number, actualCount: number) {
    super(
      `Campaign '${campaignId}' has a partially materialized storyboard: expected ${expectedCount} scenes, but found ${actualCount}.`
    );
    this.campaignId = campaignId;
    this.expectedCount = expectedCount;
    this.actualCount = actualCount;
  }
}
