export class SceneConfigurationCountMismatchError extends Error {
  override readonly name = "SceneConfigurationCountMismatchError";
  readonly campaignId: string;
  readonly expectedCount: number;
  readonly actualCount: number;

  constructor(campaignId: string, expectedCount: number, actualCount: number) {
    super(
      `Campaign '${campaignId}' expected ${expectedCount} scene configurations, but received ${actualCount}.`
    );
    this.campaignId = campaignId;
    this.expectedCount = expectedCount;
    this.actualCount = actualCount;
  }
}
