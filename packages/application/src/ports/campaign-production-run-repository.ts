import type {
  CampaignId,
  CampaignProductionRunRecord,
  CampaignProductionRunSceneRecord
} from "@cco/domain";

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
  findByAssemblyJobId(assemblyJobId: string): Promise<CampaignProductionRunRecord | undefined>;
  findRunSceneByProductionJobId(
    productionJobId: string
  ): Promise<CampaignProductionRunSceneRecord | undefined>;
  findRunScenes(runId: string): Promise<readonly CampaignProductionRunSceneRecord[]>;
  insertRunScenes(
    runId: string,
    scenes: readonly CampaignProductionRunSceneRecord[]
  ): Promise<void>;
  /**
   * Advisory count of incomplete production render jobs in the run.
   * Purely observational, never used as an authoritative gate.
   */
  countIncompleteRunScenes(runId: string): Promise<number>;
  /**
   * Atomically claims the run for assembly (transitions status from 'dispatched' to 'assembling').
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
   * Atomically claims run failure (transitions status from 'dispatched' or 'assembling' to 'failed').
   * Returns the updated run record if claimed, or undefined if already in a terminal status.
   */
  claimFailure(runId: string): Promise<CampaignProductionRunRecord | undefined>;
}
