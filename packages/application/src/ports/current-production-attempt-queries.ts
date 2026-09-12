import type {
  PersistentMediaRef,
  ProductionAttemptAvailability,
  ProductionAttemptTechnicalState
} from "@cco/contracts";
import type { CampaignId, SceneId } from "@cco/domain";

export interface CurrentProductionAttempt {
  readonly runId: string;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly attemptOrdinal: number;
  readonly productionJobId?: string | undefined;
  readonly technicalState: ProductionAttemptTechnicalState;
  readonly reviewReady: boolean;
  readonly availability: ProductionAttemptAvailability;
  readonly media?:
    | {
        readonly generationManifestId: string;
        readonly ref: PersistentMediaRef;
      }
    | undefined;
}

export interface GetCurrentProductionAttemptInput {
  readonly campaignId: CampaignId;
  readonly runId: string;
  readonly sceneId: SceneId;
}

export interface CurrentProductionAttemptQueries {
  getCurrentProductionAttempt(
    input: GetCurrentProductionAttemptInput
  ): Promise<CurrentProductionAttempt | undefined>;
}
