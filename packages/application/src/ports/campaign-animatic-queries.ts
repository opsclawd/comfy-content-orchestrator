import type { CampaignAnimaticReadModel } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";

export interface CampaignAnimaticQueries {
  getCampaignAnimatic(
    campaignId: CampaignId | string
  ): Promise<CampaignAnimaticReadModel | undefined>;
}
