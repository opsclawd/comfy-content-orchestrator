import type { JobId, JobKind, LeaseToken, RenderJob } from "@cco/domain";

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
  | { readonly outcome: "already_applied"; readonly job: RenderJob }
  | { readonly outcome: "superseded" }
  | { readonly outcome: "not_found" };

export interface JobQueuePort {
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
    manifestPayload?: Readonly<Record<string, unknown>>
  ): Promise<JobMutationResult>;
  fail(jobId: JobId, leaseToken: LeaseToken, errorTrace: string): Promise<JobMutationResult>;
}
