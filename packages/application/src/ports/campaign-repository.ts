export interface CampaignRepository<TCampaign> {
  findById(campaignId: string): Promise<TCampaign | undefined>;
  save(campaign: TCampaign): Promise<void>;
}
