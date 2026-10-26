import type {
  AcceptanceAssemblyJob,
  AcceptanceAssemblyManifest,
  AcceptanceRunScene,
  OperatorAcceptanceActionReceipt,
  OperatorAcceptanceActionScope,
  OperatorAcceptanceRun,
  OperatorAcceptanceRunStatus
} from "@cco/contracts";

export interface OperatorAcceptanceRunRepository {
  createRun(run: OperatorAcceptanceRun, scenes: readonly AcceptanceRunScene[]): Promise<void>;
  findRunById(acceptanceRunId: string): Promise<OperatorAcceptanceRun | undefined>;
  findRunByCampaignId(campaignId: string): Promise<OperatorAcceptanceRun | undefined>;
  findRunScenes(acceptanceRunId: string): Promise<readonly AcceptanceRunScene[]>;
  findRunSceneBySceneId(sceneId: string): Promise<AcceptanceRunScene | undefined>;
  updateRunStatus(
    acceptanceRunId: string,
    status: OperatorAcceptanceRunStatus,
    assemblyJobId?: string,
    actionReceiptId?: string
  ): Promise<void>;
  updateSceneAcceptedAttempt(
    acceptanceRunId: string,
    sceneId: string,
    attemptId: string,
    stagingJobId: string,
    ordinal: number
  ): Promise<void>;
  updateSceneCurrentAttempt(
    acceptanceRunId: string,
    sceneId: string,
    attemptId: string,
    ordinal: number
  ): Promise<void>;
  saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void>;
  findActionReceipt(
    scope: OperatorAcceptanceActionScope | string,
    runOrCampaignId: string,
    actionId: string
  ): Promise<OperatorAcceptanceActionReceipt | undefined>;
}

export interface AcceptanceAssemblyJobQueuePort {
  enqueue(
    job: Omit<AcceptanceAssemblyJob, "status" | "createdAt" | "updatedAt">
  ): Promise<AcceptanceAssemblyJob>;
  claim(workerId: string, leaseDurationMs: number): Promise<AcceptanceAssemblyJob | undefined>;
  start(jobId: string, leaseToken: string): Promise<void>;
  heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void>;
  complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void>;
  fail(jobId: string, error: string, leaseToken?: string): Promise<void>;
  findById(jobId: string): Promise<AcceptanceAssemblyJob | undefined>;
}

export interface AcceptanceAssemblyManifestRepository {
  saveManifest(manifest: AcceptanceAssemblyManifest): Promise<void>;
  findByJobId(jobId: string): Promise<AcceptanceAssemblyManifest | undefined>;
  findByRunId(acceptanceRunId: string): Promise<AcceptanceAssemblyManifest | undefined>;
}
