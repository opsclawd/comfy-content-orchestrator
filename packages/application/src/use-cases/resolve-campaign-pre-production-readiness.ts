import type { CampaignPreProductionReadinessReadModel } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import type { CampaignReadinessQueries } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";

export interface ResolveCampaignPreProductionReadinessDependencies {
  readonly queries: CampaignReadinessQueries;
}

export class ResolveCampaignPreProductionReadinessUseCase {
  constructor(private readonly deps: ResolveCampaignPreProductionReadinessDependencies) {}

  async execute(campaignId: CampaignId | string): Promise<CampaignPreProductionReadinessReadModel> {
    const readModel = await this.deps.queries.getCampaignPreProductionReadiness(campaignId);
    if (!readModel) {
      throw new CampaignNotFoundError(campaignId);
    }
    return readModel;
  }
}
