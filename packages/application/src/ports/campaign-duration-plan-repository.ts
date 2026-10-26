import type {
  CampaignDurationPlan,
  SceneDurationBinding,
  ReplanCampaignCommitResponse,
  ExecutionRealm
} from "@cco/contracts";

export interface ReplanActionReceipt {
  readonly actionId: string;
  readonly campaignId: string;
  readonly realm?: ExecutionRealm | undefined;
  readonly requestHash?: string | undefined;
  readonly response: ReplanCampaignCommitResponse;
  readonly createdAt: string;
}

export interface CampaignDurationPlanRepository {
  savePlan(plan: CampaignDurationPlan): Promise<void>;
  findCurrentPlanByCampaignId(campaignId: string): Promise<CampaignDurationPlan | undefined>;
  findByCampaignIdAndRevision(
    campaignId: string,
    revision: number
  ): Promise<CampaignDurationPlan | undefined>;
  saveBindings(bindings: readonly SceneDurationBinding[]): Promise<void>;
  findBindingsByPlanId(planId: string): Promise<readonly SceneDurationBinding[]>;
  findBindingBySceneId(sceneId: string): Promise<SceneDurationBinding | undefined>;
  saveReceipt?(receipt: ReplanActionReceipt): Promise<void>;
  findReceipt?(params: {
    readonly campaignId: string;
    readonly actionId: string;
  }): Promise<ReplanActionReceipt | undefined>;
  findReceiptByActionId?(
    actionId: string,
    campaignId?: string
  ): Promise<ReplanActionReceipt | undefined>;
}
