import type { JobId, JobKind, LeaseToken, RenderJob, SceneId } from "@cco/domain";

export interface EnqueueJobInput {
  readonly sceneId: SceneId;
  readonly jobKind: JobKind;
  readonly workflowTemplate: string;
  readonly injectedPayload: Readonly<Record<string, unknown>>;
  readonly maxRetries?: number;
}

export interface ClaimJobInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly allowedJobKinds?: readonly JobKind[];
}

export interface JobAdmissionGate {
  canAdmit(jobKind: JobKind): Promise<boolean>;
}

export type JobMutationResult =
  | { readonly outcome: "applied"; readonly job: RenderJob }
  | { readonly outcome: "deferred"; readonly job: RenderJob }
  | { readonly outcome: "already_applied"; readonly job: RenderJob }
  | { readonly outcome: "superseded" }
  | { readonly outcome: "not_found" };

export interface CandidateCompletionPayload {
  readonly variantOrdinal: number;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
  readonly generationPayload?: Readonly<Record<string, unknown>>;
}

export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<RenderJob>;
  claim(input: ClaimJobInput): Promise<RenderJob | undefined>;
  start(jobId: JobId, leaseToken: LeaseToken): Promise<JobMutationResult>;
  heartbeat(
    jobId: JobId,
    leaseToken: LeaseToken,
    leaseDurationMs: number
  ): Promise<JobMutationResult>;
  complete(
    jobId: JobId,
    leaseToken: LeaseToken,
    manifestPayload?: Readonly<Record<string, unknown>>,
    candidatePayload?: CandidateCompletionPayload
  ): Promise<JobMutationResult>;
  fail(jobId: JobId, leaseToken: LeaseToken, errorTrace: string): Promise<JobMutationResult>;
  defer(jobId: JobId, leaseToken: LeaseToken, reason: string): Promise<JobMutationResult>;
}

export type TransactionalJobEnqueuer = Pick<JobQueuePort, "enqueue">;
