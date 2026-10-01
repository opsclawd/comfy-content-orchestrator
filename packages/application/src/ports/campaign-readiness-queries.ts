import type { CampaignPreProductionReadinessReadModel } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";

export interface CampaignReadinessQueries {
  getCampaignPreProductionReadiness(
    campaignId: CampaignId | string
  ): Promise<CampaignPreProductionReadinessReadModel | undefined>;
}
