import type {
  CampaignId,
  CampaignProductionRunRecord,
  CampaignProductionRunSceneRecord,
  SceneId
} from "@cco/domain";

export interface RecordProductionAttemptInput {
  readonly sceneId: SceneId;
  readonly runId: string | undefined;
  readonly ordinal: number;
  readonly productionJobId: string;
  readonly specRevision: number;
  readonly selectedCandidateId?: string | undefined;
  readonly selectedCandidateRevision?: number | undefined;
  readonly seed: number;
  readonly createdReason: "initial_dispatch" | "failure_recovery" | "production_rerender";
}

export interface ProductionAttemptRecord extends RecordProductionAttemptInput {
  readonly attemptId: string;
  readonly createdAt: string;
}

export interface CreateCampaignProductionRunInput {
  readonly campaignId: CampaignId;
  readonly fingerprint: string;
  readonly status: "dispatched";
  readonly expectedTotalDurationMs: number;
}

export interface CampaignProductionRunRepository {
  createIfAbsent(
    input: CreateCampaignProductionRunInput
  ): Promise<{ readonly run: CampaignProductionRunRecord; readonly created: boolean }>;
  findById(runId: string): Promise<CampaignProductionRunRecord | undefined>;
  findByIdForUpdate(runId: string): Promise<CampaignProductionRunRecord | undefined>;
  findByAssemblyJobId(assemblyJobId: string): Promise<CampaignProductionRunRecord | undefined>;
  findRunSceneBySceneId(sceneId: string): Promise<CampaignProductionRunSceneRecord | undefined>;
  findRunSceneByProductionJobId(
    productionJobId: string
  ): Promise<CampaignProductionRunSceneRecord | undefined>;
  findRunScenes(runId: string): Promise<readonly CampaignProductionRunSceneRecord[]>;
  insertRunScenes(
    runId: string,
    scenes: readonly CampaignProductionRunSceneRecord[]
  ): Promise<void>;
  recordProductionAttempt(input: RecordProductionAttemptInput): Promise<ProductionAttemptRecord>;
  findAttemptByProductionJobId(
    productionJobId: string
  ): Promise<ProductionAttemptRecord | undefined>;
  updateCurrentAttempt(
    runId: string,
    sceneId: string,
    attempt: { attemptId: string; attemptOrdinal: number; productionJobId: string }
  ): Promise<void>;
  recordAcceptedAttempt(
    runId: string,
    sceneId: string,
    attempt: { attemptId: string; attemptOrdinal: number; productionJobId: string }
  ): Promise<{ readonly accepted: boolean }>;
  /**
   * Advisory count of incomplete production render jobs in the run.
   * Purely observational, never used as an authoritative gate.
   */
  countIncompleteRunScenes(runId: string): Promise<number>;
  /**
   * Atomically claims the run for production review (transitions status from 'dispatched' to 'production_review').
   * Returns the updated run record if claimed, or undefined if another caller won the claim.
   */
  claimForProductionReview(runId: string): Promise<CampaignProductionRunRecord | undefined>;
  /**
   * Atomically claims the run for assembly (transitions status from 'dispatched' or 'production_review' to 'assembling').
   * Returns the updated run record if claimed, or undefined if another caller won the claim.
   */
  claimForAssembly(runId: string): Promise<CampaignProductionRunRecord | undefined>;
  /**
   * Associates the enqueued assembly job ID (DeliveryAssemblyJob.jobId) with the run.
   */
  setAssemblyJobId(runId: string, assemblyJobId: string): Promise<void>;
  /**
   * Atomically claims run completion (transitions status from 'assembling' to 'completed').
   * Returns the updated run record if claimed, or undefined if not in 'assembling' status.
   */
  claimCompletion(runId: string): Promise<CampaignProductionRunRecord | undefined>;
  /**
   * Atomically claims run failure (transitions status from 'dispatched', 'production_review', or 'assembling' to 'failed').
   * Returns the updated run record if claimed, or undefined if already in a terminal status.
   */
  claimFailure(runId: string): Promise<CampaignProductionRunRecord | undefined>;
}
