import type { CampaignAnimaticReadModel } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import type { CampaignAnimaticQueries, ReviewMediaDeliveryPort } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";

export interface ResolveCampaignAnimaticDependencies {
  readonly queries: CampaignAnimaticQueries;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
}

export class ResolveCampaignAnimaticUseCase {
  constructor(private readonly deps: ResolveCampaignAnimaticDependencies) {}

  async execute(campaignId: CampaignId | string): Promise<CampaignAnimaticReadModel> {
    const readModel = await this.deps.queries.getCampaignAnimatic(campaignId);
    if (!readModel) {
      throw new CampaignNotFoundError(campaignId);
    }
    return readModel;
  }
}
