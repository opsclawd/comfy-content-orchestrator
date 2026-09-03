export class CampaignNotFoundError extends Error {
  override readonly name = "CampaignNotFoundError";
  readonly campaignId: string;

  constructor(campaignId: string) {
    super(`Campaign '${campaignId}' was not found.`);
    this.campaignId = campaignId;
  }
}
