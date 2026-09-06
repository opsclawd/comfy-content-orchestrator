import type { CampaignStatus } from "@cco/domain";

export interface CampaignRepository<TCampaign> {
  findById(campaignId: string): Promise<TCampaign | undefined>;
  findByIdForUpdate(campaignId: string): Promise<TCampaign | undefined>;
  save(campaign: TCampaign): Promise<void>;
  /**
   * Atomically projects a lifecycle status only when the campaign is still in
   * one of the expected prior states. Implemented as one guarded UPDATE.
   */
  transitionStatusIf(
    campaignId: string,
    expectedStatus: CampaignStatus | readonly CampaignStatus[],
    nextStatus: CampaignStatus,
    options?: { readonly approvedScenes?: number }
  ): Promise<boolean>;
}
